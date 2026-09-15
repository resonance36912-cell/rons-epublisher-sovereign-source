# Resonance Typography

One typographic system across every Resonance app. Pair a confident sans
with a humanist italic serif accent.

## Families

| Role          | Family            | Weights      | Source                          |
|---------------|-------------------|--------------|---------------------------------|
| Display / UI  | **Inter Tight**   | 400, 600, 800, 900 | Google Fonts              |
| Body          | **Inter**         | 400, 500, 600 | Google Fonts                   |
| Accent italic | **Instrument Serif** | 400 italic | Google Fonts                   |
| Mono / labels | **JetBrains Mono** | 400, 600    | Google Fonts                    |

### `<head>` snippet

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600;800;900&family=Inter:wght@400;500;600&family=Instrument+Serif:ital@1&family=JetBrains+Mono:wght@400;600&display=swap"
  rel="stylesheet"
/>
```

### CSS variables

```css
:root {
  --font-display: "Inter Tight", system-ui, sans-serif;
  --font-body:    "Inter", system-ui, sans-serif;
  --font-accent:  "Instrument Serif", "Times New Roman", serif;
  --font-mono:    "JetBrains Mono", ui-monospace, monospace;
}

body { font-family: var(--font-body); }
h1, h2, h3, h4 { font-family: var(--font-display); letter-spacing: -0.02em; }
.accent-italic { font-family: var(--font-accent); font-style: italic; font-weight: 400; }
.label-mono   { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.625rem; }
```

## Scale (mobile → desktop)

| Token   | Size (rem) | Use                              |
|---------|------------|----------------------------------|
| `xs`    | 0.75       | Captions, footnotes              |
| `sm`    | 0.875      | Secondary UI                     |
| `base`  | 1.00       | Body                             |
| `lg`    | 1.125      | Lead paragraphs                  |
| `xl`    | 1.25       | Card titles                      |
| `2xl`   | 1.5        | Section eyebrows                 |
| `3xl`   | 1.875      | Subheads                         |
| `4xl`   | 2.25       | H2                               |
| `5xl`   | 3.0  → 3.75 | H1 (mobile → desktop)           |
| `6xl`   | 3.75 → 4.5  | Hero supporting                 |
| `7xl`   | 4.5  → 6.0  | Hero                            |

## Voice rules

- **Display** carries weight 800–900 with negative tracking (-0.02em).
- **Accent italic** appears once per hero — a noun the brand wants to own.
- **Mono labels** are eyebrows, badges, micro-meta. Never run paragraphs in mono.
- **Body** is `text-white/65` on dark, leading-relaxed.
- No more than three sizes in any single section.

## Don't

- Don't mix Inter Tight with another sans.
- Don't use the italic serif for anything other than a one-word accent.
- Don't lowercase mono labels.
- Don't tint headings — colour lives in gradients, not type.
