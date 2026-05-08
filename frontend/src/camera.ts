/**
 * Vader Camera Vision — live viewfinder with frame capture for Claude vision analysis.
 */

export class CameraView {
  private overlay: HTMLDivElement;
  private videoWrapper: HTMLDivElement;
  private video: HTMLVideoElement;
  private statusText: HTMLDivElement;
  private stream: MediaStream | null = null;
  public isOpen = false;

  constructor(private onCapture: (base64: string, text: string) => void) {
    // Full-screen dim overlay
    this.overlay = document.createElement("div");
    this.overlay.id = "camera-overlay";
    Object.assign(this.overlay.style, {
      position: "fixed", inset: "0",
      background: "rgba(3,4,8,0.88)",
      backdropFilter: "blur(4px)",
      zIndex: "900", display: "none",
      alignItems: "center", justifyContent: "center", flexDirection: "column",
    });

    // Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      color: "rgba(14,165,233,0.6)", fontFamily: "'Courier New',monospace",
      fontSize: "11px", letterSpacing: "4px", marginBottom: "16px",
    });
    header.textContent = "VADER / VISUAL";

    // Video wrapper — the rectangle
    this.videoWrapper = document.createElement("div");
    this.videoWrapper.id = "camera-wrapper";
    Object.assign(this.videoWrapper.style, {
      width: "600px", maxWidth: "88vw",
      border: "1px solid rgba(14,165,233,0.3)",
      borderRadius: "4px", overflow: "hidden",
      background: "#000",
      transition: "transform 0.4s cubic-bezier(0.4,0,0.2,1)",
      boxShadow: "0 0 40px rgba(14,165,233,0.08)",
    });

    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    Object.assign(this.video.style, { width: "100%", display: "block" });
    this.videoWrapper.appendChild(this.video);

    // Status text below video
    this.statusText = document.createElement("div");
    Object.assign(this.statusText.style, {
      color: "rgba(14,165,233,0.35)", fontFamily: "'Courier New',monospace",
      fontSize: "10px", letterSpacing: "2px", marginTop: "12px", height: "14px",
    });
    this.statusText.textContent = "SAY \"LOOK AT THIS\" OR CLICK LOOK";

    // Button row
    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, {
      display: "flex", gap: "12px", marginTop: "16px",
    });

    const lookBtn = this._makeBtn("LOOK", () => this.capture("What do you see?"));
    const closeBtn = this._makeBtn("CLOSE", () => this.close());

    btnRow.appendChild(lookBtn);
    btnRow.appendChild(closeBtn);

    this.overlay.appendChild(header);
    this.overlay.appendChild(this.videoWrapper);
    this.overlay.appendChild(this.statusText);
    this.overlay.appendChild(btnRow);
    document.body.appendChild(this.overlay);

    // Close on backdrop click
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
  }

  private _makeBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    Object.assign(btn.style, {
      background: "none", border: "1px solid rgba(14,165,233,0.3)",
      color: "rgba(14,165,233,0.6)", fontFamily: "'Courier New',monospace",
      fontSize: "11px", letterSpacing: "2px", padding: "8px 20px",
      cursor: "pointer", borderRadius: "2px",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.borderColor = "rgba(14,165,233,0.7)";
      btn.style.color = "rgba(14,165,233,1)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.borderColor = "rgba(14,165,233,0.3)";
      btn.style.color = "rgba(14,165,233,0.6)";
    });
    btn.addEventListener("click", onClick);
    return btn;
  }

  async open() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      this.video.srcObject = this.stream;
      this.overlay.style.display = "flex";
      this.isOpen = true;
      this.setStatus("READY — SAY \"LOOK AT THIS\" OR CLICK LOOK");
    } catch {
      // Fallback to any camera if environment-facing not available
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        this.video.srcObject = this.stream;
        this.overlay.style.display = "flex";
        this.isOpen = true;
        this.setStatus("READY — SAY \"LOOK AT THIS\" OR CLICK LOOK");
      } catch (err) {
        console.error("[camera] access denied:", err);
      }
    }
  }

  close() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.overlay.style.display = "none";
    this.videoWrapper.style.transform = "scale(1)";
    this.isOpen = false;
  }

  capture(userText: string) {
    if (!this.stream) return;
    const canvas = document.createElement("canvas");
    canvas.width = this.video.videoWidth || 640;
    canvas.height = this.video.videoHeight || 480;
    canvas.getContext("2d")!.drawImage(this.video, 0, 0);
    const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
    this.zoomIn();
    this.setStatus("ANALYZING...");
    this.onCapture(base64, userText);
  }

  zoomIn() {
    this.videoWrapper.style.transform = "scale(1.35)";
  }

  zoomOut() {
    this.videoWrapper.style.transform = "scale(1)";
    this.setStatus("READY — SAY \"LOOK AT THIS\" OR CLICK LOOK");
  }

  setStatus(text: string) {
    this.statusText.textContent = text;
  }
}
