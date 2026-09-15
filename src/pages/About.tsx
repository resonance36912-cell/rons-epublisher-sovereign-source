import { Link } from "react-router-dom";
import { AppFooter } from "@/components/storyforge/AppFooter";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/storyforge/PageHeader";
import {
  Search, Settings2, Sparkles, BookOpen, Image, Download,
  ArrowRight, Globe, Layers, Volume2, PenLine
} from "lucide-react";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import { Seo } from "@/components/Seo";

const FEATURE_KEYS = [
  { icon: Search, key: "research" },
  { icon: Globe, key: "source" },
  { icon: Settings2, key: "config" },
  { icon: PenLine, key: "speech" },
  { icon: Sparkles, key: "storyboard" },
  { icon: Layers, key: "storyline" },
  { icon: BookOpen, key: "preview" },
  { icon: Image, key: "visual" },
  { icon: Volume2, key: "narration" },
  { icon: Download, key: "export" },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.07, duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function About() {
  const { t } = useI18n();

  const WORKFLOW_STEPS = [
    t("about.step.topic"),
    t("about.step.research"),
    t("about.step.configure"),
    t("about.step.generate"),
    t("about.step.storyline"),
    t("about.step.visualbook"),
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Seo
        title="About — AudioVisual eBook by Resonance ePublisher"
        description="How Resonance ePublisher turns a topic into a researched, narrated, illustrated AudioVisual eBook — workflow, features, and exports."
        path="/about"
      />
      <PageHeader links={[
        { to: "/", label: t("nav.home") },
        { to: "/contact", label: t("nav.contact") },
      ]} />

      <main className="flex-1">
        <section className="container px-6 pt-16 pb-12 text-center max-w-3xl mx-auto space-y-4">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-4xl md:text-5xl font-display font-bold tracking-tight gradient-text"
          >
            {t("about.title")}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-lg text-muted-foreground leading-relaxed"
          >
            {t("about.subtitle")}
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
          >
            <Button asChild size="lg" className="gap-2 mt-4">
              <Link to="/">
                {t("about.getStarted")} <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </motion.div>
        </section>

        <section className="container px-6 pb-8 max-w-4xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-center">
            {WORKFLOW_STEPS.map((label, i) => (
              <motion.div
                key={label}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                className="bg-card border rounded-lg p-3 space-y-1"
              >
                <span className="inline-flex w-7 h-7 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-bold">
                  {i + 1}
                </span>
                <p className="text-xs font-medium">{label}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="container px-6 pb-20 max-w-5xl mx-auto">
          <div className="grid gap-6 md:grid-cols-2">
            {FEATURE_KEYS.map((f, i) => (
              <motion.div
                key={f.key}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-40px" }}
                variants={fadeUp}
                className="bg-card border rounded-xl p-6 space-y-3 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <f.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-base">{t(`about.feat.${f.key}.title`)}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t(`about.feat.${f.key}.desc`)}
                </p>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
