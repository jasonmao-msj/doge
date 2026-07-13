import { memo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { getGlossaryEntry } from "../glossaryStore";
import "../../../styles/glossary-term.css";

function extractText(children: ReactNode): string {
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map((child) => extractText(child as ReactNode)).join("");
  }
  return "";
}

interface GlossaryTermChipProps {
  children?: ReactNode;
}

/**
 * GlossaryTermChip — 消息正文中被 glossary 插件标注的技术名词。
 * 虚线下划线提示可点击，点击弹出通俗解释卡片；词条查不到时退化为纯文本。
 */
export const GlossaryTermChip = memo(function GlossaryTermChip({
  children,
}: GlossaryTermChipProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const text = extractText(children);
  const entry = getGlossaryEntry(text);

  if (!entry) {
    return <>{children}</>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="glossary-term-chip">
          {children}
        </button>
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          side="top"
          className="glossary-term-popover"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="glossary-term-popover-term">{entry.term}</div>
          <p className="glossary-term-popover-explanation">
            {entry.explanation}
          </p>
          <div className="glossary-term-popover-source">
            {t("pluginsPage.glossarySource", { plugin: entry.pluginName })}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
});
