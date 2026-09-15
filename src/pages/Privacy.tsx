import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppFooter } from "@/components/storyforge/AppFooter";
import { Seo } from "@/components/Seo";

export default function Privacy() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Seo
        title="Privacy Policy — Resonance ePublisher"
        description="How Resonance ePublisher collects, stores, and protects your data when using the AI AudioVisual eBook platform."
        path="/privacy"
      />
      <main className="container max-w-3xl px-6 py-12 flex-1">
        <Button variant="ghost" asChild className="mb-8 gap-2">
          <Link to="/"><ArrowLeft className="w-4 h-4" /> Back</Link>
        </Button>

        <article className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <h1>Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: March 29, 2026</p>

          <h2>1. Information We Collect</h2>
          <p>When you use Resonance ePublisher, we may collect the following information:</p>
          <ul>
            <li><strong>Research Data:</strong> Topics and sources you submit for storybook generation.</li>
            <li><strong>Usage Data:</strong> Pages visited, features used, session duration, and interaction patterns.</li>
            <li><strong>Device Information:</strong> Browser type, operating system, and screen resolution.</li>
            <li><strong>Account Data:</strong> Email address if you create an account.</li>
          </ul>

          <h2>2. How We Use Your Information</h2>
          <ul>
            <li>To provide AI-powered research and storybook generation.</li>
            <li>To improve and optimize our platform's performance and features.</li>
            <li>To communicate with you about updates and support.</li>
            <li>To monitor and prevent fraud or abuse of our services.</li>
          </ul>

          <h2>3. Data Storage & Security</h2>
          <p>Your data is stored securely using industry-standard encryption and access controls. We use cloud infrastructure with enterprise-grade security measures.</p>

          <h2>4. Third-Party Services</h2>
          <ul>
            <li><strong>AI Services:</strong> To power our research engine, content generation, and image creation.</li>
            <li><strong>Analytics:</strong> To understand usage patterns and improve the platform.</li>
          </ul>

          <h2>5. Your Rights</h2>
          <p>You have the right to access, correct, or delete your personal data. Contact us at <a href="mailto:support@resonance-podcast.com" className="text-primary">support@resonance-podcast.com</a>.</p>

          <h2>6. Contact</h2>
          <p>For privacy inquiries, email us at <a href="mailto:support@resonance-podcast.com" className="text-primary">support@resonance-podcast.com</a>.</p>
        </article>
      </main>
      <AppFooter />
    </div>
  );
}
