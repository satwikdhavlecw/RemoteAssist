import "../sidepanel/styles.css";

const grantButton =
  document.querySelector<HTMLButtonElement>("#grant-microphone");
const closeButton = document.querySelector<HTMLButtonElement>(
  "#close-permission-tab",
);
const status = document.querySelector<HTMLElement>("#permission-status");

if (!grantButton || !closeButton || !status) {
  throw new Error("RemoteAssist microphone permission page is incomplete.");
}

grantButton.addEventListener("click", () => {
  grantButton.disabled = true;
  status.textContent = "Waiting for Chrome's microphone permission promptâ€¦";
  void navigator.mediaDevices
    .getUserMedia({ audio: true, video: false })
    .then((stream) => {
      stream.getTracks().forEach((track) => track.stop());
      status.textContent =
        "Microphone permission granted. No audio was retained or sent to OpenAI. Return to RemoteAssist and select Enable microphone.";
      grantButton.hidden = true;
      closeButton.hidden = false;
    })
    .catch((error: unknown) => {
      grantButton.disabled = false;
      const detail =
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : "Chrome did not grant microphone permission.";
      status.textContent = `${detail} Check chrome://settings/content/microphone and try again.`;
    });
});

closeButton.addEventListener("click", () => window.close());
