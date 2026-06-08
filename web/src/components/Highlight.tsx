import { Fragment } from "react";
import styles from "./NoteCard.module.css";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function Highlight({
  text,
  terms,
}: {
  text: string;
  terms?: string[];
}) {
  const active = (terms ?? []).filter((t) => t.length > 0);
  if (active.length === 0) return <>{text}</>;

  const pattern = new RegExp(`(${active.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className={styles.mark}>
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
