// Small pieces shared by the studio screens.
import { useState } from "react";
import { Icon } from "./icons";

export interface Camera {
  stream: MediaStream | null;
  /** The page-lifetime element playing `stream`; the stage paints it as the camera tile. */
  live: HTMLVideoElement;
  error: string | null;
  cams: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  retry(): void;
}

/** The first two letters of the first name: "Abdel Abdelwaly" → "Ab". */
export const initials = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.charAt(0).toUpperCase() + first.slice(1, 2).toLowerCase();
};

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const roomLink = (code: string) => {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", code);
  const deck = new URLSearchParams(location.search).get("deck");
  if (deck) url.searchParams.set("deck", deck);
  return url.toString();
};

export function CopyLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="st-copy"
      title="Copy the room link"
      aria-label={`Room ${code}, copy link`}
      onClick={() => {
        void navigator.clipboard?.writeText(roomLink(code)).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <span>{code}</span>
      <Icon name={copied ? "check" : "copy"} size={14} />
    </button>
  );
}

/** The app's mark and the screen's name, as the room's top-left corner shows them. */
export function Brand({ as: Tag = "h1" }: { as?: "h1" | "span" }) {
  return (
    <Tag className="st-brand">
      <span className="cf-mark" aria-hidden="true" />
      Studio
    </Tag>
  );
}
