import { useKeepAudioLocal } from "../hooks/useKeepAudioLocal";

import styles from "./KeepAudioLocalToggle.module.css";

// 48-E — desktop-only privacy setting. With it on (default), a locally-transcribed meeting's audio
// never leaves the machine — only the transcript is stored. Renders nothing in the web app.
export default function KeepAudioLocalToggle() {
  const { keepLocal, setKeepLocal, isDesktop } = useKeepAudioLocal();

  if (!isDesktop) return null;

  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        data-testid="keep-audio-local-toggle"
        checked={keepLocal}
        onChange={(e) => setKeepLocal(e.target.checked)}
      />
      Keep recordings on this device only
    </label>
  );
}
