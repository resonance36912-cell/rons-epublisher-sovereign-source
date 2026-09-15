import { useState, useMemo } from "react";
import { useStoryForge } from "../StoryForgeContext";
import { resolveDesign, isDarkBg } from "@/lib/ebook-design";
import { motion, AnimatePresence } from "framer-motion";

const SAMPLE_TITLE = "The Journey Begins";
const SAMPLE_BODY =
  "In the heart of the ancient forest, where sunlight filtered through a canopy of emerald leaves, a young traveller set out on a path that would change everything.";

type PreviewPage = "cover" | "chapter";

/** Inline mini-chapter preview rendered with the active design settings. */
export function DesignMiniPreview() {
  const { config, setConfig, chapters } = useStoryForge();
  const [page, setPage] = useState<PreviewPage>("cover");
  const d = resolveDesign(config);
  const dark = isDarkBg(d.bg);
  const designKey = useMemo(() => `${config.ebookFont}-${config.ebookColorSchemeId}-${config.ebookLayout}-${config.orientation}`, [config.ebookFont, config.ebookColorSchemeId, config.ebookLayout, config.orientation]);

  const bookTitle = config.topic || "Your eBook Title";
  const title = chapters[0]?.title || SAMPLE_TITLE;
  const body = chapters[0]?.body?.slice(0, 220) || SAMPLE_BODY;
  const imgUrl = chapters[0]?.imageUrl;

  const imgPlaceholder = (
    <div
      className="flex items-center justify-center"
      style={{
        background: `linear-gradient(135deg, ${d.accent}18, ${d.chapterBg})`,
        borderRadius: 6,
        width: "100%",
        height: "100%",
        minHeight: 60,
      }}
    >
      <span style={{ color: d.accent, opacity: 0.45, fontSize: 22 }}>📖</span>
    </div>
  );

  const imgEl = imgUrl ? (
    <img
      src={imgUrl}
      alt=""
      className="w-full h-full object-cover"
      style={{ borderRadius: 6 }}
    />
  ) : (
    imgPlaceholder
  );

  const titleEl = (
    <p
      style={{
        fontFamily: d.fontFamily,
        color: d.accent,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.25,
        marginBottom: 3,
      }}
    >
      {title}
    </p>
  );

  const bodyEl = (
    <p
      style={{
        fontFamily: d.fontFamily,
        color: d.text + "bb",
        fontSize: 7.5,
        lineHeight: 1.65,
      }}
    >
      {body.length > 180 ? body.slice(0, 180) + "…" : body}
    </p>
  );

  const chapterLabel = (
    <p
      style={{
        fontFamily: d.fontFamily,
        color: d.text + "66",
        fontSize: 5.5,
        textTransform: "uppercase",
        letterSpacing: 1.5,
        marginBottom: 2,
      }}
    >
      Chapter 1
    </p>
  );

  /* ── Cover page ── */
  const coverView = (
    <div
      className="w-full h-full flex flex-col items-center justify-center text-center"
      style={{ padding: 20 }}
    >
      {/* Decorative accent line */}
      <div
        style={{
          width: 40,
          height: 2,
          backgroundColor: d.accent,
          borderRadius: 1,
          marginBottom: 14,
          opacity: 0.6,
        }}
      />

      {/* Book title */}
      <p
        style={{
          fontFamily: d.fontFamily,
          color: d.text,
          fontSize: 16,
          fontWeight: 700,
          lineHeight: 1.3,
          marginBottom: 8,
          maxWidth: "90%",
        }}
      >
        {bookTitle}
      </p>

      {/* Subtitle / accent line */}
      <div
        style={{
          width: 24,
          height: 1,
          backgroundColor: d.accent + "66",
          borderRadius: 1,
          marginBottom: 10,
        }}
      />

      {/* Author / publisher */}
      <p
        style={{
          fontFamily: d.fontFamily,
          color: d.text + "88",
          fontSize: 7,
          textTransform: "uppercase",
          letterSpacing: 2,
          marginBottom: 16,
        }}
      >
        Resonance ePublisher
      </p>

      {/* Decorative accent block */}
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 8,
          background: `linear-gradient(135deg, ${d.accent}30, ${d.accent}08)`,
          border: `1px solid ${d.accent}22`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 24, opacity: 0.5 }}>📚</span>
      </div>

      {/* Chapter count */}
      <p
        style={{
          fontFamily: d.fontFamily,
          color: d.text + "55",
          fontSize: 6,
          marginTop: 14,
          letterSpacing: 1,
        }}
      >
        {chapters.length || 5} Chapters
      </p>
    </div>
  );

  /* ── Chapter page (existing layouts) ── */
  const chapterView = (
    <div className="w-full h-full flex flex-col" style={{ padding: 14 }}>
      {d.layout === "side-by-side" ? (
        <>
          {chapterLabel}
          {titleEl}
          <div className="flex gap-2 flex-1 mt-1" style={{ minHeight: 0 }}>
            <div className="w-[45%] shrink-0" style={{ borderRadius: 6, overflow: "hidden" }}>
              {imgEl}
            </div>
            <div className="flex-1 overflow-hidden">{bodyEl}</div>
          </div>
        </>
      ) : d.layout === "overlay" ? (
        <div className="relative flex-1 flex flex-col justify-end" style={{ borderRadius: 6, overflow: "hidden" }}>
          <div className="absolute inset-0">
            {imgUrl ? (
              <img src={imgUrl} alt="" className="w-full h-full object-cover" style={{ filter: "brightness(0.4)" }} />
            ) : (
              <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${d.accent}22, ${d.chapterBg})`, filter: "brightness(0.6)" }} />
            )}
          </div>
          <div className="relative z-10 p-2.5">
            <p style={{ fontFamily: d.fontFamily, color: "#ffffffcc", fontSize: 5.5, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 2 }}>Chapter 1</p>
            <p style={{ fontFamily: d.fontFamily, color: "#ffffffe6", fontSize: 11, fontWeight: 700, lineHeight: 1.25, marginBottom: 3 }}>{title}</p>
            <p style={{ fontFamily: d.fontFamily, color: "#ffffffaa", fontSize: 7, lineHeight: 1.6 }}>{body.slice(0, 100)}…</p>
          </div>
        </div>
      ) : d.layout === "full-bleed" ? (
        <>
          <div className="w-full shrink-0 -mx-[14px] -mt-[14px] mb-2" style={{ width: "calc(100% + 28px)", height: "45%", overflow: "hidden" }}>
            {imgUrl ? (
              <img src={imgUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${d.accent}18, ${d.chapterBg})` }} />
            )}
          </div>
          {chapterLabel}
          {titleEl}
          <div className="mt-1 overflow-hidden flex-1">{bodyEl}</div>
        </>
      ) : (
        <>
          {chapterLabel}
          {titleEl}
          <div className="mt-1 overflow-hidden" style={{ maxHeight: "30%" }}>{bodyEl}</div>
          <div className="flex-1 mt-2" style={{ borderRadius: 6, overflow: "hidden", minHeight: 0 }}>{imgEl}</div>
        </>
      )}
    </div>
  );

  return (
    <div className="glass-card p-4 space-y-2">
      {/* Tab switcher */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Live Preview</p>
        <div className="flex gap-1">
          {(["portrait", "landscape"] as const).map((o) => (
            <button
              key={o}
              onClick={() => setConfig(prev => ({ ...prev, orientation: o }))}
              className="text-[10px] px-2 py-0.5 rounded-full capitalize transition-colors"
              style={{
                backgroundColor: config.orientation === o ? d.accent + "22" : "transparent",
                color: config.orientation === o ? d.accent : undefined,
                fontWeight: config.orientation === o ? 600 : 400,
              }}
            >
              {o === "portrait" ? "⬜ Portrait" : "⬛ Landscape"}
            </button>
          ))}
          <span className="w-px bg-border mx-0.5" />
          {(["cover", "chapter"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className="text-[10px] px-2 py-0.5 rounded-full capitalize transition-colors"
              style={{
                backgroundColor: page === p ? d.accent + "22" : "transparent",
                color: page === p ? d.accent : undefined,
                fontWeight: page === p ? 600 : 400,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Outer book frame */}
      <div
        className="relative mx-auto overflow-hidden transition-all duration-300"
        style={{
          backgroundColor: d.bg,
          borderRadius: 10,
          border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
          maxWidth: config.orientation === "landscape" ? 340 : 280,
          aspectRatio: config.orientation === "landscape" ? "4 / 3" : "3 / 4",
          boxShadow: dark
            ? "0 8px 30px rgba(0,0,0,0.5)"
            : "0 8px 30px rgba(0,0,0,0.08)",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={`${page}-${designKey}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="w-full h-full"
          >
            {page === "cover" ? coverView : chapterView}
          </motion.div>
        </AnimatePresence>

        {/* Tiny page footer */}
        <div
          className="absolute bottom-0 inset-x-0 flex justify-center py-1"
          style={{
            borderTop: `1px solid ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
            backgroundColor: d.chapterBg + "cc",
          }}
        >
          <span style={{ fontSize: 5, color: d.text + "55" }}>
            {page === "cover" ? "Cover" : `1 / ${chapters.length || 5}`}
          </span>
        </div>
      </div>

      {/* Design badge */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: d.accent + "18", color: d.accent }}>{d.fontName}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: d.accent + "18", color: d.accent }}>{d.schemeName}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: d.accent + "18", color: d.accent }}>{d.layout}</span>
      </div>
    </div>
  );
}
