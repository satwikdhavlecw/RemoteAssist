// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceControls } from "../src/sidepanel/VoiceControls.js";
import {
  disconnectVoice,
  grantMicrophoneConsent,
  recordRealtimeActionProposal,
} from "../src/sidepanel/api.js";

vi.mock("../src/sidepanel/api.js", () => ({
  grantMicrophoneConsent: vi.fn(async () => undefined),
  connectRealtime: vi.fn(async () => ({
    provider: "openai_realtime",
    sessionId: "rs_voice",
    model: "gpt-realtime-test",
    answerSdp: "v=0\r\nt=test-answer",
    transport: "webrtc",
  })),
  disconnectVoice: vi.fn(async () => undefined),
  interruptVoice: vi.fn(async () => undefined),
  recordRealtimeActionProposal: vi.fn(async (_sessionId, proposal) => proposal),
}));

describe("voice controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let stopTrack: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let closePeer: ReturnType<typeof vi.fn>;
  let createTab: ReturnType<typeof vi.fn>;
  let channelSend: ReturnType<typeof vi.fn>;
  let realtimeMessageHandler: ((event: MessageEvent<string>) => void) | null;

  beforeEach(() => {
    vi.mocked(grantMicrophoneConsent).mockClear();
    vi.mocked(disconnectVoice).mockClear();
    vi.mocked(recordRealtimeActionProposal).mockClear();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    stopTrack = vi.fn();
    closePeer = vi.fn();
    const track = {
      enabled: true,
      stop: stopTrack,
    } as unknown as MediaStreamTrack;
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    getUserMedia = vi.fn(async () => stream);
    createTab = vi.fn(async () => undefined);
    channelSend = vi.fn();
    realtimeMessageHandler = null;
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) =>
          `chrome-extension://remoteassist-test/${path}`,
      },
      tabs: { create: createTab },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    });

    const channel = {
      readyState: "open",
      addEventListener: vi.fn(
        (type: string, listener: (event: MessageEvent<string>) => void) => {
          if (type === "message") realtimeMessageHandler = listener;
        },
      ),
      send: channelSend,
      close: vi.fn(),
    } as unknown as RTCDataChannel;
    class TestPeerConnection {
      connectionState: RTCPeerConnectionState = "connected";
      onconnectionstatechange: (() => void) | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      addTrack = vi.fn();
      createDataChannel = vi.fn(() => channel);
      createOffer = vi.fn(async () => ({
        type: "offer" as RTCSdpType,
        sdp: "v=0\r\nt=test-offer",
      }));
      setLocalDescription = vi.fn(async () => undefined);
      setRemoteDescription = vi.fn(async () => undefined);
      close = closePeer;
    }
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("connects the microphone to WebRTC and closes it when the session pauses", async () => {
    const props = {
      sessionId: "rs_voice",
      issue: "Salesforce sign-in failed",
      application: "Salesforce",
      pageTitle: "Salesforce sign in",
      visibleError: "SAML authentication failed",
      visibleText: ["SAML authentication failed", "Try Again"],
      pageFingerprint: "sha256:first",
      controls: [
        {
          elementId: "retry-button",
          role: "button",
          name: "Try Again",
          disabled: false,
          rectangle: { x: 0, y: 0, width: 100, height: 40 },
        },
      ],
      actionFollowUp: null,
      onTranscript: vi.fn(),
      onActionProposal: vi.fn(),
    };

    await act(async () => {
      root.render(<VoiceControls {...props} paused={false} />);
    });
    const enableButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Enable microphone");
    expect(enableButton).toBeTruthy();

    await act(async () => {
      enableButton!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(grantMicrophoneConsent).toHaveBeenCalledOnce();
    expect(stopTrack).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "AI received an updated sanitized view of the shared tab.",
    );

    await act(async () => {
      realtimeMessageHandler!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "response.done",
            response: {
              output: [
                {
                  type: "function_call",
                  name: "propose_browser_action",
                  call_id: "call_retry",
                  arguments: JSON.stringify({
                    control_name: "Try Again",
                    action_type: "CLICK_ELEMENT",
                    purpose: "Retry the failed request once",
                  }),
                },
              ],
            },
          }),
        }),
      );
    });
    expect(props.onActionProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: "call_retry",
        controlName: "Try Again",
        actionType: "CLICK_ELEMENT",
      }),
    );
    expect(recordRealtimeActionProposal).toHaveBeenCalledWith(
      "rs_voice",
      expect.objectContaining({ callId: "call_retry" }),
    );
    expect(channelSend).toHaveBeenCalledWith(
      expect.stringContaining("function_call_output"),
    );

    const changedProps = {
      ...props,
      visibleError: "Connection restored",
      visibleText: ["Connection restored", "Continue"],
      pageFingerprint: "sha256:second",
      actionFollowUp: {
        id: 1,
        summary:
          "CLICK_ELEMENT on Try Again finished with executed; page changed: true; failure: none.",
      },
      controls: [
        {
          elementId: "continue-button",
          role: "button",
          name: "Continue",
          disabled: false,
          rectangle: { x: 0, y: 0, width: 100, height: 40 },
        },
      ],
    };
    await act(async () => {
      root.render(<VoiceControls {...changedProps} paused={false} />);
    });
    expect(
      channelSend.mock.calls.some(
        ([message]) =>
          String(message).includes("session.update") &&
          String(message).includes("Continue"),
      ),
    ).toBe(true);
    expect(
      channelSend.mock.calls.some(([message]) =>
        String(message).includes("deterministic execution status"),
      ),
    ).toBe(true);
    expect(
      channelSend.mock.calls.some(([message]) =>
        String(message).includes("Silent action review only"),
      ),
    ).toBe(true);
    expect(
      channelSend.mock.calls.some(
        ([message]) =>
          String(message).includes('"modalities":["text"]') &&
          String(message).includes("propose_browser_action"),
      ),
    ).toBe(true);
    expect(
      channelSend.mock.calls.some(
        ([message]) =>
          String(message).includes("sanitized page update") &&
          String(message).includes("Connection restored"),
      ),
    ).toBe(true);

    await act(async () => {
      root.render(<VoiceControls {...changedProps} paused />);
    });

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(closePeer).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "Microphone and voice guidance are off while support is paused.",
    );
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === "Enable microphone",
      )?.disabled,
    ).toBe(true);
  });

  it("opens a full extension tab without server traffic when the side panel prompt is suppressed", async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException("Permission dismissed", "NotAllowedError"),
    );
    await act(async () => {
      root.render(
        <VoiceControls
          sessionId="rs_voice"
          paused={false}
          issue="Sign-in failed"
          application={null}
          pageTitle={null}
          visibleError={null}
          visibleText={[]}
          pageFingerprint={null}
          controls={[]}
          actionFollowUp={null}
          onTranscript={vi.fn()}
          onActionProposal={vi.fn()}
        />,
      );
    });
    const enableButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Enable microphone");

    await act(async () => {
      enableButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(grantMicrophoneConsent).not.toHaveBeenCalled();
    expect(disconnectVoice).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Chrome cannot show its microphone prompt inside the side panel",
    );
    expect(container.textContent).toContain("No audio was sent to OpenAI");
    const permissionButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (button) => button.textContent === "Grant microphone in extension tab",
    );

    await act(async () => permissionButton!.click());

    expect(createTab).toHaveBeenCalledWith({
      url: "chrome-extension://remoteassist-test/microphone-permission.html",
    });
  });
});
