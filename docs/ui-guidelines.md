# Zenote UI guidelines

Zenote is a dark-only product. Its public presence should feel quiet, exact, and cinematic: a near-black field, soft neutral typography, finely controlled warm-copper emphasis, and product proof rather than decorative SaaS imagery.

## Visual system

- Use the dark token system in `app/globals.css`; do not add a light theme or `next-themes`.
- Backgrounds are near-black rather than pure black. Surfaces step through charcoal values with a clear job: base, quiet surface, raised product surface, and temporary popover.
- Copper/orange is a signal, not a fill color. Reserve it for primary calls to action, active states, small product details, and restrained light/glow.
- Use thin, low-contrast borders to define geometry. Prefer spacing and tonal contrast over stacks of cards.
- Keep corners modestly rounded. Shadows should be soft, dark, and directional; use glow only to support focus or product depth.

## Typography and layout

- Geist is the public type system. Use weight, tracking, and line length before adding decorative type treatments.
- Headlines are compact, high-contrast, and editorial. Body copy should remain comfortably readable at a constrained line width.
- Give hero and product proof deliberate room, but do not create empty vertical space for its own sake.
- Mobile is a first-class layout: preserve hierarchy, readable targets, and horizontal containment at 375px through wide desktop.

## Motion

- Use `motion/react` from the installed `motion` package as the default implementation for all new UI animation, including state changes, layout transitions, menus, drawers, loading states, and component entrances. Do not introduce a second UI animation library.
- Keep motion purposeful and short: generally 150–400ms for interactions, with slightly longer one-time entrances only when they establish hierarchy. Prefer a smooth ease-out or a deliberate spring over linear movement.
- Respect `prefers-reduced-motion` with `useReducedMotion()` and provide an immediate or minimal fallback.
- Keep Motion code in an isolated client component when possible. Use `layout` or `layoutId` for visible layout changes instead of manually measuring and animating React state.
- Reserve GSAP for existing landing-page storytelling or genuinely complex scroll choreography. Scope it with `useGSAP` and a React ref so animations and ScrollTriggers clean up automatically; do not mix GSAP and Motion in the same component tree.
- Avoid perpetual motion, scroll hijacking, animated rainbow gradients, and decorative movement that does not help comprehension.

For collapsible navigation, hide labels at the collapsed state boundary, keep icon controls in fixed-size alignment boxes, and animate the rail width/position as one Motion transition. Never allow labels to wrap while a navigation container is closing.

## Components and resources

1. Inspect `components/ui` first and compose existing shadcn/Base UI primitives where appropriate.
2. Use shadcn MCP when an accessible primitive is missing.
3. Use 21st as a reference and acceleration source, then adapt any selected pattern to Zenote tokens, spacing, accessibility, and performance.
4. The `@aceternity` and `@cult-ui` registries are secondary sources. Do not mix unrelated visual languages.
5. Apply the Taste Skill when doing visual redesign work to challenge generic layouts and preserve intentional hierarchy.

## Authenticated chat

- Keep the desktop sidebar compact and collapsible; use the existing Sheet behavior for mobile rather than a second navigation implementation.
- Keep transcript content within a readable measure of roughly 720-800px. Assistant responses sit directly on the canvas; user prompts may use a quiet raised surface.
- Keep the conversation header and per-message actions visually subordinate to the transcript and composer.
- Preserve keyboard access, visible focus, autosizing input, manual-scroll intent, a reachable scroll-to-bottom control, and safe-area spacing around the mobile composer.
- Chat uses real AssemblyAI-backed streaming through `/api/chat`, while preserving the existing sidebar, model picker, composer, SmoothUI components, message rendering, stop control, and responsive dark layout. Display only registry model names, never gateway infrastructure labels.
- Preserve partial output on stop or failure and show user-safe errors in the existing message error state. Actual returned model metadata belongs to each response, independently from the currently selected model. Do not claim the selected model responded when fallback metadata is missing.
- Sidebar/history data and the rich sample conversation remain fixtures. Appwrite conversation persistence is still not implemented; refresh does not restore new messages.
- Attachments/AWS/tool orchestration are scaffolded only. Local attachment previews are not uploads or processed context; sending is blocked until attachments are removed. Do not imply that files have been read, tools have run, or sample reasoning is live model reasoning.

## Avoid

- Generic bento grids, endless feature cards, excessive pills, fake testimonials, fake metrics, or fake logos.
- Over-rounded surfaces, decorative icons without a job, huge gradient blobs, rainbow color, and gratuitous glassmorphism.
- Dashboard clutter, duplicated controls, dense navigation, or customer-facing infrastructure jargon.
- Any light-mode implementation or theme toggle.
