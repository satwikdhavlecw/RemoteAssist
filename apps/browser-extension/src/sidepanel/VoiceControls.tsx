import { useEffect, useRef, useState } from "react";
import {
  governedActionsForControl,
  governedBrowserActions,
} from "@remoteassist/policy-model";
import type { SafeControl } from "@remoteassist/shared-types";
import {
  connectRealtime,
  disconnectVoice,
  grantMicrophoneConsent,
  interruptVoice,
  recordRealtimeActionProposal,
  synthesizeVoiceText,
  submitVoiceQuery,
} from "./api.js";
import {
  parseRealtimeActionProposal,
  type RealtimeActionProposal,
  type RealtimeFunctionCall,
} from "./realtime-actions.js";

interface VoiceControlsProps {
  sessionId: string;
  paused: boolean;
  issue: string;
  application: string | null;
  pageTitle: string | null;
  visibleError: string | null;
  visibleText: string[];
  pageFingerprint: string | null;
  controls: SafeControl[];
  actionFollowUp: { id: number; summary: string } | null;
  onTranscript: (
    transcript: string,
  ) =>
    | Promise<RealtimeActionProposal | null>
    | RealtimeActionProposal
    | null
    | void;
  onActionProposal: (proposal: RealtimeActionProposal) => void;
}

interface RealtimeServerEvent {
  type?: string;
  transcript?: string;
  error?: { message?: string };
  response?: { output?: RealtimeFunctionCall[] };
}

type ActiveVoiceProvider =
  "openai_realtime" | "google_voice" | "elevenlabs" | "browser_speech";

function voiceProviderLabel(provider: ActiveVoiceProvider | null): string {
  if (provider === "elevenlabs") return "ElevenLabs Voice";
  if (provider === "google_voice") return "Google Cloud Voice";
  if (provider === "openai_realtime") return "OpenAI Realtime";
  if (provider === "browser_speech") return "Browser Speech API";
  return "Voice guidance";
}

function actionSpeech(proposal: RealtimeActionProposal): string {
  const verb =
    proposal.actionType === "CLICK_ELEMENT"
      ? "click"
      : proposal.actionType === "FOCUS_ELEMENT"
        ? "focus"
        : "scroll to";
  return `Next step: review the allow-once card to ${verb} ${proposal.controlName}. Approve it only if you want RemoteAssist to perform that step.`;
}

function isGenericEscalation(text: string): boolean {
  return /\b(contact|ask|request|call|reach out to)\b.{0,80}\b(admin|administrator|support engineer|support team|human support|help desk|it team)\b/i.test(
    text,
  );
}

export function VoiceControls({
  sessionId,
  paused,
  issue,
  application,
  pageTitle,
  visibleError,
  visibleText,
  pageFingerprint,
  controls,
  actionFollowUp,
  onTranscript,
  onActionProposal,
}: VoiceControlsProps) {
  const [state, setState] = useState<
    "off" | "enabling" | "ready" | "muted" | "error"
  >("off");
  const [caption, setCaption] = useState(issue);
  const [assistantCaption, setAssistantCaption] = useState("");
  const [activeProvider, setActiveProvider] =
    useState<ActiveVoiceProvider | null>(null);
  const [showPermissionRecovery, setShowPermissionRecovery] = useState(false);
  const [message, setMessage] = useState(
    "Microphone access is off until you enable it.",
  );
  const stream = useRef<MediaStream | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const microphoneConsentGranted = useRef(false);
  const currentControls = useRef(controls);
  const actionProposalHandler = useRef(onActionProposal);
  const sentPageFingerprint = useRef<string | null>(null);
  const requestedFollowUp = useRef(0);
  const suppressNextAssistantTranscript = useRef(false);
  const activeProviderRef = useRef<ActiveVoiceProvider | null>(null);
  const backendVoiceBusyRef = useRef(false);
  const assistantSpeakingRef = useRef(false);
  const browserVoiceEnabledRef = useRef(false);

  function stopBrowserSpeech(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function startBrowserRecognition(): void {
    if (
      activeProviderRef.current !== "browser_speech" ||
      !browserVoiceEnabledRef.current ||
      backendVoiceBusyRef.current ||
      assistantSpeakingRef.current ||
      recognitionRef.current
    ) {
      return;
    }
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setState("error");
      setMessage(
        "Chrome or Edge does not expose the browser speech recognition API in this context.",
      );
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    recognition.onresult = (event: any) => {
      let interim = "";
      let finalText = "";
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const text = String(event.results[index][0]?.transcript ?? "").trim();
        if (event.results[index].isFinal) finalText += ` ${text}`;
        else interim += ` ${text}`;
      }
      const transcript = (finalText || interim).trim();
      if (transcript) setCaption(transcript);
      if (finalText.trim() && !backendVoiceBusyRef.current) {
        recognition.onend = null;
        recognition.stop();
        recognitionRef.current = null;
        void handleVoiceQuery(finalText.trim());
      }
    };
    recognition.onerror = (event: any) => {
      recognitionRef.current = null;
      if (event.error === "aborted" || event.error === "no-speech") {
        window.setTimeout(startBrowserRecognition, 250);
        return;
      }
      setState("error");
      setMessage(
        `Browser speech recognition failed: ${event.error || "unknown error"}.`,
      );
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (
        activeProviderRef.current === "browser_speech" &&
        !backendVoiceBusyRef.current &&
        !assistantSpeakingRef.current
      ) {
        window.setTimeout(startBrowserRecognition, 250);
      }
    };
    try {
      recognition.start();
      setMessage("Browser Speech API is ready. Speak your question.");
    } catch (error) {
      recognitionRef.current = null;
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Browser speech recognition could not start.",
      );
    }
  }

  useEffect(() => {
    currentControls.current = controls;
    actionProposalHandler.current = onActionProposal;
  }, [controls, onActionProposal]);

  function closeRealtimeConnection(): void {
    browserVoiceEnabledRef.current = false;
    if (vadIntervalRef.current) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    stopBrowserSpeech();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    dataChannel.current?.close();
    dataChannel.current = null;
    if (peerConnection.current) {
      peerConnection.current.onconnectionstatechange = null;
      peerConnection.current.ontrack = null;
      peerConnection.current.close();
    }
    peerConnection.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (remoteAudio.current) {
      remoteAudio.current.pause();
      remoteAudio.current.srcObject = null;
      remoteAudio.current = null;
    }
  }

  useEffect(() => () => closeRealtimeConnection(), []);

  useEffect(() => {
    if (!paused) return;
    closeRealtimeConnection();
    setState("off");
    setMessage(
      "Microphone and voice guidance are off while support is paused.",
    );
  }, [paused]);

  function handleRealtimeEvent(event: MessageEvent<string>): void {
    let payload: RealtimeServerEvent;
    try {
      payload = JSON.parse(event.data) as RealtimeServerEvent;
    } catch {
      return;
    }
    if (
      payload.type ===
        "conversation.item.input_audio_transcription.completed" &&
      payload.transcript?.trim()
    ) {
      setCaption(payload.transcript.trim());
      setMessage("Speech transcribed. Confirm the caption before using it.");
    }
    if (
      payload.type === "response.output_audio_transcript.done" &&
      payload.transcript?.trim()
    ) {
      if (suppressNextAssistantTranscript.current) {
        suppressNextAssistantTranscript.current = false;
        return;
      }
      setAssistantCaption(payload.transcript.trim());
    }
    if (payload.type === "error") {
      setMessage("OpenAI Realtime reported an error. Try reconnecting.");
    }
    if (payload.type === "response.done") {
      for (const call of payload.response?.output ?? []) {
        if (
          call.type !== "function_call" ||
          call.name !== "propose_browser_action"
        ) {
          continue;
        }
        void processActionProposal(call);
      }
    }
  }

  async function processActionProposal(
    call: RealtimeFunctionCall,
  ): Promise<void> {
    const parsed = parseRealtimeActionProposal(call, currentControls.current);
    let result: Record<string, string> = {
      status: "rejected",
      reason:
        "The proposal was malformed, higher risk, or did not match a current observed control.",
    };

    if (parsed) {
      try {
        const proposal = await recordRealtimeActionProposal(sessionId, parsed);
        actionProposalHandler.current(proposal);
        setMessage(
          `AI proposed ${proposal.actionType} for ${proposal.controlName}. Review the separate allow-once card.`,
        );
        result = {
          status: "awaiting_user_approval",
          control_name: proposal.controlName,
          action_type: proposal.actionType,
        };
      } catch {
        setMessage(
          "The AI browser proposal was rejected by RemoteAssist policy.",
        );
        result = {
          status: "rejected",
          reason: "RemoteAssist policy rejected the browser proposal.",
        };
      }
    }

    if (
      typeof call.call_id === "string" &&
      dataChannel.current?.readyState === "open"
    ) {
      dataChannel.current.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          },
        }),
      );
    }
  }

  useEffect(() => {
    if (
      state !== "ready" ||
      !pageFingerprint ||
      sentPageFingerprint.current === pageFingerprint ||
      dataChannel.current?.readyState !== "open"
    ) {
      return;
    }

    const eligibleControls = controls
      .map((control) => ({
        ...control,
        actions: governedActionsForControl(control),
      }))
      .filter((control) => control.actions.length > 0)
      .slice(0, 50);
    const tools = eligibleControls.length
      ? [
          {
            type: "function",
            name: "propose_browser_action",
            description:
              "Propose one currently eligible click, focus, or scroll action for explicit allow-once user approval. This does not execute the action.",
            parameters: {
              type: "object",
              properties: {
                control_name: {
                  type: "string",
                  enum: eligibleControls.map((control) => control.name),
                },
                action_type: {
                  type: "string",
                  enum: governedBrowserActions,
                },
                purpose: { type: "string", minLength: 3, maxLength: 500 },
              },
              required: ["control_name", "action_type", "purpose"],
              additionalProperties: false,
            },
          },
        ]
      : [];
    const pageSummary = [
      "RemoteAssist sanitized page update. This is silent context only — do not speak or respond to this message.",
      application ? `Application: ${application}` : null,
      pageTitle ? `Page title: ${pageTitle}` : null,
      visibleError ? `Visible error: ${visibleError}` : null,
      ...visibleText
        .slice(0, 40)
        .map((text) => `Visible text: ${text.slice(0, 500)}`),
      eligibleControls.length
        ? `Eligible controls and actions: ${eligibleControls.map((control) => `${control.name} [${control.actions.join(", ")}]`).join("; ")}`
        : "Eligible controls and actions: none",
    ]
      .filter(Boolean)
      .join("\n");

    dataChannel.current.send(
      JSON.stringify({
        type: "session.update",
        session: { tools, tool_choice: "auto" },
      }),
    );
    dataChannel.current.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: pageSummary }],
        },
      }),
    );
    sentPageFingerprint.current = pageFingerprint;
    setMessage("AI received an updated sanitized view of the shared tab.");
  }, [
    application,
    controls,
    pageFingerprint,
    pageTitle,
    state,
    visibleError,
    visibleText,
  ]);

  useEffect(() => {
    if (
      state !== "ready" ||
      !actionFollowUp ||
      actionFollowUp.id <= requestedFollowUp.current ||
      dataChannel.current?.readyState !== "open"
    ) {
      return;
    }
    dataChannel.current.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `RemoteAssist deterministic execution status. This is silent context — do not narrate the control name. ${actionFollowUp.summary}`,
            },
          ],
        },
      }),
    );
    suppressNextAssistantTranscript.current = true;
    dataChannel.current.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text"],
          instructions:
            "Silent action review only. Do not speak, greet, summarize, or explain. If exactly one listed low-risk next action is clear from the latest page context, call propose_browser_action once. Otherwise return no user-facing guidance and wait.",
        },
      }),
    );
    window.setTimeout(() => {
      suppressNextAssistantTranscript.current = false;
    }, 3000);
    requestedFollowUp.current = actionFollowUp.id;
    setMessage("AI is reviewing the result and preparing the next step.");
  }, [actionFollowUp, state]);

  async function speakBrowserReply(text: string): Promise<void> {
    if (!text.trim() || !("speechSynthesis" in window)) return;
    stopBrowserSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 1;
    utterance.pitch = 1;
    assistantSpeakingRef.current = true;
    setMessage("Browser Speech API is speaking...");
    await new Promise<void>((resolve) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
    assistantSpeakingRef.current = false;
    setMessage("Browser Speech API is ready. Speak your question.");
    window.setTimeout(startBrowserRecognition, 250);
  }

  async function handleVoiceQuery(
    query: string | null = null,
    audioBase64?: string,
  ): Promise<void> {
    if (backendVoiceBusyRef.current) return;
    backendVoiceBusyRef.current = true;
    try {
      setMessage("Processing live voice turn...");
      const data = await submitVoiceQuery(
        sessionId,
        query,
        application,
        visibleError,
        audioBase64,
      );

      if (data.transcript) {
        setCaption(data.transcript);
        setMessage(`Heard: "${data.transcript}". Preparing reply...`);
      }
      const proposedAction = data.transcript
        ? ((await onTranscript(data.transcript)) ?? null)
        : null;
      if (data.searchResponse?.groundedGuidance?.proposedNextStep) {
        setAssistantCaption(
          data.searchResponse.groundedGuidance.proposedNextStep,
        );
      } else if (data.assistantText) {
        setAssistantCaption(data.assistantText);
      }
      const assistantText =
        data.assistantText ??
        data.searchResponse?.groundedGuidance?.proposedNextStep ??
        "";
      const spokenText = proposedAction
        ? [
            isGenericEscalation(assistantText) ? "" : assistantText,
            actionSpeech(proposedAction),
          ]
            .filter(Boolean)
            .join(" ")
        : assistantText;
      let audioContent = data.audioContent;
      if (
        proposedAction &&
        spokenText.trim() &&
        activeProviderRef.current !== "browser_speech"
      ) {
        setAssistantCaption(spokenText);
        const synthesized = await synthesizeVoiceText(sessionId, spokenText);
        audioContent = synthesized.audioContent || audioContent;
      }
      if (activeProviderRef.current === "browser_speech" && spokenText.trim()) {
        await speakBrowserReply(spokenText);
      } else if (audioContent) {
        const audio = new Audio("data:audio/mp3;base64," + audioContent);
        assistantSpeakingRef.current = true;
        setMessage(
          `${voiceProviderLabel(activeProviderRef.current)} is speaking...`,
        );
        let playbackSucceeded = false;
        await new Promise<void>((resolve) => {
          audio.onended = () => {
            playbackSucceeded = true;
            resolve();
          };
          audio.onerror = () => resolve();
          void audio.play().catch((e) => {
            console.error("Audio playback failed:", e);
            resolve();
          });
        });
        assistantSpeakingRef.current = false;
        if (playbackSucceeded) {
          setMessage(
            `${voiceProviderLabel(activeProviderRef.current)} live turn mode is ready. Speak now.`,
          );
        } else {
          setMessage(
            "Voice reply was generated but Chrome could not play the audio. Check the side panel console for the playback error.",
          );
        }
      } else {
        setMessage(
          spokenText
            ? `${voiceProviderLabel(activeProviderRef.current)} returned text but no playable voice audio. Check the API log for ElevenLabs TTS errors.`
            : `${voiceProviderLabel(activeProviderRef.current)} live turn mode is ready. Speak now.`,
        );
      }
    } catch (e) {
      console.error(e);
      setMessage("Error processing voice query.");
    } finally {
      assistantSpeakingRef.current = false;
      backendVoiceBusyRef.current = false;
    }
  }

  async function enable(): Promise<void> {
    setState("enabling");
    setShowPermissionRecovery(false);
    setMessage("Waiting for microphone permission…");
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      stream.current = microphone;
      if (!microphoneConsentGranted.current) {
        await grantMicrophoneConsent(sessionId);
        microphoneConsentGranted.current = true;
      }

      const connection = new RTCPeerConnection();
      peerConnection.current = connection;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      remoteAudio.current = audio;
      connection.ontrack = (event) => {
        audio.srcObject = event.streams[0] ?? null;
        void audio.play().catch(() => undefined);
      };
      microphone
        .getAudioTracks()
        .forEach((track) => connection.addTrack(track, microphone));

      const events = connection.createDataChannel("oai-events");
      dataChannel.current = events;
      events.addEventListener("message", handleRealtimeEvent);
      connection.onconnectionstatechange = () => {
        if (
          ["failed", "disconnected", "closed"].includes(
            connection.connectionState,
          )
        ) {
          closeRealtimeConnection();
          void disconnectVoice(sessionId).catch(() => undefined);
          setState("error");
          setMessage(
            `${voiceProviderLabel(activeProviderRef.current)} disconnected. Enable the microphone to reconnect.`,
          );
        }
      };

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      if (!offer.sdp)
        throw new Error("The browser did not create a WebRTC offer.");
      const realtime = await connectRealtime(
        sessionId,
        offer.sdp,
        issue,
        application,
        visibleError,
        controls
          .map((control) => ({
            ...control,
            actions: governedActionsForControl(control),
          }))
          .filter((control) => control.actions.length > 0)
          .slice(0, 50)
          .map((control) => ({
            name: control.name,
            role: control.role,
            actions: control.actions,
          })),
      );
      setActiveProvider(realtime.provider);
      activeProviderRef.current = realtime.provider;
      if (realtime.provider === "openai_realtime") {
        await connection.setRemoteDescription({
          type: "answer",
          sdp: realtime.answerSdp,
        });
        setState("ready");
        setMessage(`${realtime.model} voice session connected through WebRTC.`);
      } else if (realtime.provider === "browser_speech") {
        closeRealtimeConnection();
        browserVoiceEnabledRef.current = true;
        setState("ready");
        startBrowserRecognition();
      } else {
        setState("ready");
        const providerName = voiceProviderLabel(realtime.provider);
        setMessage(`Connecting to ${providerName}...`);

        try {
          const audioContext = new (
            window.AudioContext || (window as any).webkitAudioContext
          )();
          audioContextRef.current = audioContext;
          const source = audioContext.createMediaStreamSource(microphone);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          const maxAudioBytes = 900_000;
          const maxUtteranceMs = 5_000;
          let isSpeaking = false;
          let silenceStartTime = Date.now();
          let recordingStartedAt = 0;
          const silenceThreshold = 15;
          const silenceDuration = 700;

          audioChunksRef.current = [];
          const mediaRecorder = new MediaRecorder(microphone, {
            mimeType: "audio/webm",
          });
          mediaRecorderRef.current = mediaRecorder;

          mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunksRef.current, {
              type: "audio/webm",
            });
            audioChunksRef.current = [];
            if (audioBlob.size > maxAudioBytes) {
              setMessage(
                "Voice turn was too long. Please speak one short request at a time.",
              );
              return;
            }
            if (audioBlob.size > 1000) {
              setMessage("Sending voice turn to backend...");
              const reader = new FileReader();
              reader.readAsDataURL(audioBlob);
              reader.onloadend = async () => {
                const base64Url = reader.result as string;
                const base64 = base64Url.split(",")[1];
                if (base64) {
                  void handleVoiceQuery(null, base64);
                }
              };
            }
          };

          const checkVolume = () => {
            if (backendVoiceBusyRef.current || assistantSpeakingRef.current) {
              return;
            }
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
              sum += dataArray[i] ?? 0;
            }
            const averageVolume = sum / bufferLength;

            if (averageVolume > silenceThreshold) {
              if (!isSpeaking) {
                isSpeaking = true;
                audioChunksRef.current = [];
                recordingStartedAt = Date.now();
                if (mediaRecorderRef.current?.state === "inactive") {
                  mediaRecorderRef.current.start(150);
                }
                setMessage(
                  `Listening via ${providerName}... finish your short turn.`,
                );
              }
              silenceStartTime = Date.now();
            } else {
              if (
                isSpeaking &&
                Date.now() - silenceStartTime > silenceDuration
              ) {
                isSpeaking = false;
                if (
                  mediaRecorderRef.current &&
                  mediaRecorderRef.current.state === "recording"
                ) {
                  mediaRecorderRef.current.stop();
                }
              }
            }
            if (
              mediaRecorderRef.current?.state === "recording" &&
              Date.now() - recordingStartedAt > maxUtteranceMs
            ) {
              isSpeaking = false;
              mediaRecorderRef.current.stop();
            }
          };

          vadIntervalRef.current = window.setInterval(checkVolume, 60);
          setMessage(`${providerName} live turn mode is ready. Speak now.`);
        } catch (vadErr) {
          console.error("VAD initialization failed:", vadErr);
          setMessage(
            `Error starting speech detection: ${vadErr instanceof Error ? vadErr.message : String(vadErr)}`,
          );
        }
      }
    } catch (caught) {
      closeRealtimeConnection();
      if (microphoneConsentGranted.current) {
        await disconnectVoice(sessionId).catch(() => undefined);
      }
      setState("error");
      const errorName =
        caught && typeof caught === "object" && "name" in caught
          ? String(caught.name)
          : "";
      const errorMessage =
        caught &&
        typeof caught === "object" &&
        "message" in caught &&
        typeof caught.message === "string"
          ? caught.message
          : "";
      if (errorName === "NotAllowedError") {
        setShowPermissionRecovery(true);
        setMessage(
          /dismiss/i.test(errorMessage)
            ? "Chrome cannot show its microphone prompt inside the side panel. Grant permission once in a full extension tab."
            : "Chrome has blocked microphone access. Grant permission in a full extension tab, then try again.",
        );
      } else if (errorName === "NotFoundError") {
        setMessage("Chrome could not find an available microphone.");
      } else if (errorName === "NotReadableError") {
        setMessage(
          "Chrome could not open the microphone. Close other apps using it, then try again.",
        );
      } else {
        setMessage(errorMessage || "Voice could not start.");
      }
    }
  }

  async function openMicrophonePermissionTab(): Promise<void> {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("microphone-permission.html"),
      });
      setMessage(
        "Use the new RemoteAssist tab to grant microphone permission, then return and select Enable microphone.",
      );
    } catch {
      setMessage(
        "Open the RemoteAssist extension details, allow microphone access, then try again.",
      );
    }
  }

  function toggleMute(): void {
    if (activeProviderRef.current === "browser_speech") {
      if (state === "muted") {
        setState("ready");
        startBrowserRecognition();
        setMessage("Browser Speech API is ready. Speak your question.");
      } else {
        if (recognitionRef.current) {
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
          recognitionRef.current = null;
        }
        setState("muted");
        setMessage("Browser microphone is muted.");
      }
      return;
    }
    const tracks = stream.current?.getAudioTracks() ?? [];
    const enableTracks = state === "muted";
    tracks.forEach((track) => {
      track.enabled = enableTracks;
    });
    setState(enableTracks ? "ready" : "muted");
    setMessage(enableTracks ? "Microphone is ready." : "Microphone is muted.");
  }

  async function interrupt(): Promise<void> {
    if (activeProviderRef.current === "browser_speech") {
      stopBrowserSpeech();
      assistantSpeakingRef.current = false;
      setMessage("Browser speech reply interrupted.");
      if (state !== "muted") window.setTimeout(startBrowserRecognition, 250);
      return;
    }
    try {
      await interruptVoice(sessionId);
      if (dataChannel.current?.readyState === "open") {
        dataChannel.current.send(JSON.stringify({ type: "response.cancel" }));
        dataChannel.current.send(
          JSON.stringify({ type: "output_audio_buffer.clear" }),
        );
      }
      setMessage("OpenAI voice response interrupted.");
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not interrupt voice.",
      );
    }
  }

  return (
    <section className="card voice-card">
      <div className="compact-heading">
        <div>
          <p className="section-label">{voiceProviderLabel(activeProvider)}</p>
          <h2>Private microphone consent</h2>
        </div>
        <span className={`pill pill-${state}`}>{state}</span>
      </div>
      <p className="muted-copy">{message}</p>
      {showPermissionRecovery && (
        <div className="mode-notice" role="note">
          The browser permission is separate from RemoteAssist consent. No audio
          was sent to OpenAI or another voice provider.
          <button
            className="text-button"
            onClick={() => void openMicrophonePermissionTab()}
          >
            Grant microphone in extension tab
          </button>
        </div>
      )}
      {state === "off" || state === "error" || state === "enabling" ? (
        <button
          className="secondary-button"
          onClick={() => void enable()}
          disabled={paused || state === "enabling"}
        >
          {state === "enabling" ? "Enabling…" : "Enable microphone"}
        </button>
      ) : (
        <div className="inline-actions">
          <button className="secondary-button" onClick={toggleMute}>
            {state === "muted" ? "Unmute" : "Mute"}
          </button>
          <button className="secondary-button" onClick={() => void interrupt()}>
            Interrupt voice
          </button>
        </div>
      )}
      <label className="caption-label" htmlFor="voice-caption">
        Confirmed microphone transcript
      </label>
      <textarea
        id="voice-caption"
        rows={2}
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
      />
      <button
        className="text-button"
        onClick={() => onTranscript(caption.trim())}
        disabled={!caption.trim()}
      >
        Use this transcript as the reported issue
      </button>
      {assistantCaption && (
        <p className="muted-copy" aria-live="polite">
          <strong>{voiceProviderLabel(activeProvider)}:</strong>{" "}
          {assistantCaption}
        </p>
      )}
      <p className="privacy-note">
        When enabled, microphone audio and sanitized support context are sent to
        {activeProvider === "openai_realtime"
          ? " OpenAI Realtime"
          : activeProvider === "browser_speech"
            ? " the browser Web Speech service and the RemoteAssist API for guidance"
            : " the RemoteAssist API for backend voice processing"}
        . RemoteAssist does not create a local audio recording.
      </p>
    </section>
  );
}
