import { MessageCircle, Mail, Phone, Youtube, Facebook, MapPin, Clock, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppFooter } from "@/components/storyforge/AppFooter";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/storyforge/PageHeader";
import { motion } from "framer-motion";
import { Seo } from "@/components/Seo";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function Contact() {
  const { t } = useI18n();

  const CONTACTS = [
    {
      icon: MessageCircle,
      title: "WhatsApp",
      value: "+27 83 261 5492",
      subtitle: t("contact.fastestResponse"),
      desc: t("contact.whatsappDesc"),
      action: t("contact.chatWhatsApp"),
      href: "https://wa.me/27832615492",
    },
    {
      icon: Mail,
      title: t("auth.email"),
      value: "support@resonance-podcast.com",
      subtitle: t("contact.24hrResponse"),
      desc: t("contact.emailDesc"),
      action: t("contact.sendEmail"),
      href: "mailto:support@resonance-podcast.com",
    },
    {
      icon: Phone,
      title: t("contact.callNow").replace(" Now", "").replace(" Nou", ""),
      value: "+27 83 261 5492",
      subtitle: t("contact.monFri"),
      desc: t("contact.phoneDesc"),
      action: t("contact.callNow"),
      href: "tel:+27832615492",
    },
  ];

  const SOCIALS = [
    {
      icon: Youtube,
      title: "YouTube",
      value: "@resonance36912",
      subtitle: "2K+ subscribers",
      desc: t("contact.youtubeDesc"),
      action: t("contact.subscribe"),
      href: "https://youtube.com/@resonance36912",
    },
    {
      icon: Facebook,
      title: "Facebook",
      value: "The Resonance Podcast",
      subtitle: t("contact.joinCommunity"),
      desc: t("contact.facebookDesc"),
      action: t("contact.followUs"),
      href: "https://facebook.com/TheResonancePodcast",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Seo
        title="Contact — AudioVisual eBook by Resonance ePublisher"
        description="Reach Resonance ePublisher via WhatsApp, email, or phone. Cape Town–based support for AI AudioVisual eBook creators."
        path="/contact"
      />
      <PageHeader links={[
        { to: "/", label: t("nav.home") },
        { to: "/about", label: t("nav.about") },
      ]} />

      <main className="container max-w-4xl px-6 py-12 flex-1">
        <div className="text-center space-y-3 mb-12">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-3xl md:text-4xl font-display font-bold"
          >
            {t("contact.title")} <span className="gradient-text">Resonance</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-muted-foreground max-w-xl mx-auto"
          >
            {t("contact.subtitle")}
          </motion.p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-8">
          {CONTACTS.map((c, i) => (
            <motion.div
              key={c.href}
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              className="glass-card p-6 space-y-3 hover:border-primary/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <c.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold">{c.title}</h3>
              <p className="text-sm text-primary">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.subtitle}</p>
              <p className="text-sm text-muted-foreground">{c.desc}</p>
              <Button variant="outline" size="sm" asChild>
                <a href={c.href} target="_blank" rel="noopener noreferrer">{c.action}</a>
              </Button>
            </motion.div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-12">
          {SOCIALS.map((s, i) => (
            <motion.div
              key={s.href}
              custom={i + 3}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              className="glass-card p-6 space-y-3 hover:border-primary/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <s.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-primary">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.subtitle}</p>
              <p className="text-sm text-muted-foreground">{s.desc}</p>
              <Button variant="outline" size="sm" asChild>
                <a href={s.href} target="_blank" rel="noopener noreferrer">{s.action}</a>
              </Button>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: MapPin, labelKey: "contact.location", value: "Cape Town, South Africa" },
            { icon: Clock, labelKey: "contact.responseTime", value: t("contact.within24") },
            { icon: Globe, labelKey: "contact.languages", value: "English, Afrikaans" },
          ].map((item, i) => (
            <motion.div
              key={item.labelKey}
              custom={i + 5}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              className="glass-card p-4 text-center"
            >
              <item.icon className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{t(item.labelKey)}</p>
              <p className="text-sm font-medium">{item.value}</p>
            </motion.div>
          ))}
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
