import React from "react";

interface HighlightTextProps {
  text: string;
  highlight: string;
}

export function HighlightText({ text, highlight }: HighlightTextProps) {
  if (!highlight || !highlight.trim()) {
    return <>{text}</>;
  }

  const cleanHighlight = highlight.trim();
  const escaped = cleanHighlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  const lowerHighlight = cleanHighlight.toLowerCase();

  // 不使用 regex.test(part)：帶 gi flag 的 RegExp 具 lastIndex 狀態性，
  // 反覆呼叫會交替 true/false，導致高亮閃爍不穩定。改以字串比對判斷是否匹配。
  return (
    <>
      {parts.map((part, i) =>
        part !== "" && part.toLowerCase() === lowerHighlight ? (
          <mark key={i} className="search-highlight">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}
