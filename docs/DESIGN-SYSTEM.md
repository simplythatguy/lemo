# Lemo design system

`src/base.css` is the only place a colour, size, radius, shadow or duration is written down. Screen CSS uses its tokens. `src/design.test.ts` fails the build when a stylesheet uses a raw value, when an icon-only control has no tooltip, or when a token is missing. Numbers in brackets point to the sources at the end.

## Type

- Set every text in Inter Variable, with optical sizing on. [11]
- Use only the sizes `--text-12`, `13`, `14`, `15`, `17`, `20`, `28` and `40`. The one exception is the countdown, at `calc(var(--text-40) * 4)`. [8, 12]
- Use three weights: `--weight-body` (450) for reading, `--weight-label` (520) for labels and buttons, `--weight-title` (600) for titles. Never use a light weight. [11]
- Give titles of 28px and above `--tracking-title` (-0.02em). Leave smaller text at Inter's own spacing.
- Give room codes `--tracking-code`, the extra spacing that all-caps needs. [12]
- Set every count, timer and clock in `font-variant-numeric: tabular-nums`, so digits do not jump as they change.
- Keep reading text between 15px and 17px, at a line height of 1.5 to 1.6. [12]

## Space

- Space only in steps of `--space-4`, `8`, `12`, `16`, `24`, `32`, `48` and `64`. [9]
- Put related things closer together than unrelated things. Spacing does the grouping, not boxes or lines. [8, 9]
- To pull a control's text into line with the column edge, use a negative margin of the same token as the control's padding.

## Radii

- `--radius-tag` (6) is for tags and tooltips.
- `--radius-control` (10) is for buttons, fields, icon buttons and transcript rows.
- `--radius-card` (14) is for cards, slide thumbnails, the stage, camera tiles and the rows of the demo list.
- `--radius-sheet` (20) is for sheets, dialogs, menus and popovers.
- `--radius-full` is for circles, pills and thin bars.
- A control inside a container gets the container's radius minus its padding, as in `calc(var(--radius-sheet) - var(--space-8))`.
- Marks and glyphs that scale (the Lemo mark, project logos, the stop square) use a percentage, so they keep their shape at every size.

## Colour

- Keep the screen neutral. Colour is only for finding what matters. [7, 16]
- `--ink` is body text (Lc 105 on white). `--ink-2` is secondary text (Lc 88). `--ink-3` is tertiary text (Lc 77). `--ink-4` is quiet metadata and placeholders (Lc 68 on white, at least Lc 60 on `--fill` and `--hover`). [15]
- Never use a text colour below Lc 75 for paragraphs, or below Lc 60 for anything people must read. [15]
- `--primary` (ink) fills the one primary button on a screen. Text on it is `--on-dark`. [13]
- `--accent` (indigo) marks only the Lemo mark, the focus ring and where you are: the current step, the live mic, and where a dragged thing will land. The slide on stage gets the indigo ring; groups are told apart by spacing, not colour.
- `--red` and `--red-ink` mean recording or an error that blocks. Use `--red-ink` for red text.
- `--green` means recorded.
- `--line` and `--line-2` are hairlines. `--fill`, `--fill-hover` and `--hover` are the only tinted surfaces.
- `--shade`, `--shade-hover`, `--shade-deep`, `--scrim`, `--glass` and `--veil` sit over video, slides and the page. Never use them as decoration. `--shade-deep` is the camera picker's dim around the camera.
- `--on-dark-wash` is the hover on a dark camera surface (`--ink` with `--on-dark` text), shown wherever a camera has no picture.
- `--dim` is the one dim behind a modal (the player, a phone sheet): dark enough to read as a dim, never a grey fog.
- The app has no dark theme. Do not add dark tokens.

## Depth

- Only popovers, sheets and the drop overlay get `--shadow-pop`. Everything else is flat, separated by space or a hairline. [14]
- Use `--edge` as an inner hairline on images that could melt into the white page.

## Motion

- Use one curve, `--ease`. Use linear only for meters that follow live data. The exception is `--camera-glide`, the stage canvas's own camera glide, for anything that outlines the camera.
- Use `--dur-control` (150ms) for controls and `--dur-sheet` (220ms) for sheets and dialogs. Larger movements get longer durations. [17]
- Use `--dur-meter` and `--dur-progress` only for meters and progress bars that follow a ticking value. Use `--dur-pulse` only for the recording and loading pulse.
- Respond to every action within 400ms. If work takes longer, show progress. [3]
- `base.css` turns all motion off for `prefers-reduced-motion`. Never add motion that only works with it on. [18]

## Buttons

- Give every button a role class: `btn is-primary`, `btn is-secondary` or `btn is-quiet`. [13]
- Use `is-primary` for the one most likely action on a screen. Never use it for a destructive action. [13]
- Use `is-secondary` (hairline, neutral text) sparingly, for the second action people still need to find.
- Use `is-quiet` (no border, no fill until hover) for everything else with a label.
- Use `icon-btn` for icon-only controls. They are transparent, 36px square (32px with `is-sm`), and show a fill on hover.
- There are three sizes: `is-lg` (44), default (36) and `is-sm` (32). Buttons, icon buttons and fields of the same size are the same height, so a row of controls shares one centre line.
- Show a disabled control as a faded version of its own colour. `base.css` handles this, so never restyle `:disabled`.
- A desktop button may name its key after its label in a `kbd`: the app font at 12px, faded, with no chip or border. Touch screens hide it.
- A button that must still explain itself while unavailable (its tooltip says why) uses `aria-disabled="true"` instead of `disabled`, and its handler returns early. It fades the same way.

## Tooltips

- Give every icon-only control an `aria-label` and a `data-tip`. Never give it a `title`. [7]
- `src/Tooltip.tsx` shows `data-tip` on mouse hover after a short delay, and at once on keyboard focus. It lives in the top layer, so no container clips it.
- Keep a `data-tip` to a few words. Put a keyboard shortcut in brackets: "Next slide (→)".

## Touch targets

- On `(pointer: coarse)`, every `btn`, `icon-btn` and `[data-tip]` control has a hit area of at least 44px. The visible control can stay smaller. [1, 10]
- Never make a capability depend on hover. A control that is hidden until hover is always visible on `(hover: none)`.

## Icons

- Use only `Icon` from `src/icons.tsx` (Lucide shapes). Add new shapes there.
- Use only the sizes 12, 14, 16, 20 and 28. 16 is the default. 20 is for icon buttons that lead a screen. The stroke follows the size, so every icon looks the same weight.
- Icons are `currentColor`. Never colour an icon to decorate it.

## States

- Empty page: one vertically centred column of the title, the one action that fills the screen and at most one quiet line, with no illustration and no text that explains it. [2] Never put the action inside a frame. Where a file can be dropped, the drop target shows only while a file is dragged.
- Loading: show progress in place, as a pulse on the thing that is loading or a bar with a number. Never use a full-screen spinner. [3]
- Error: say what went wrong and how to fix it, next to the thing that failed, in `--red-ink`. A blocking error wins the eye over the primary action. [4]

## Copy

- Never write helper text, subtitles that restate a label, or instructions under a field.
- Never put anything above a title: no eyebrow, step number or tag.
- Never show a zero count or an empty badge.
- Keep labels and button names to a few words, in sentence case.

## Rewards

- Mark success quietly, where it happened: a check and the length on the recorded group, or the count going up. [5, 6]
- Never use confetti, sounds or celebration screens.
- Make the end of the flow, the finished video, the strongest moment on screen. [5]
- Show how far the team has come, such as 2 of 3 recorded, so the last takes feel close. [6]

## Sources

1. Laws of UX, Fitts's Law. https://lawsofux.com/fittss-law/
2. Laws of UX, Hick's Law. https://lawsofux.com/hicks-law/
3. Laws of UX, Doherty Threshold. https://lawsofux.com/doherty-threshold/
4. Laws of UX, Von Restorff Effect. https://lawsofux.com/von-restorff-effect/
5. Laws of UX, Peak-End Rule. https://lawsofux.com/peak-end-rule/
6. Laws of UX, Goal-Gradient Effect. https://lawsofux.com/goal-gradient-effect/
7. Laws of UX, Aesthetic-Usability Effect. https://lawsofux.com/aesthetic-usability-effect/
8. NN/g, Visual Hierarchy in UX. https://www.nngroup.com/articles/visual-hierarchy-ux-definition/
9. NN/g, Proximity Principle in Visual Design. https://www.nngroup.com/articles/gestalt-proximity/
10. Apple HIG, Layout. https://developer.apple.com/design/human-interface-guidelines/layout
11. Apple HIG, Typography. https://developer.apple.com/design/human-interface-guidelines/typography
12. Butterick, Practical Typography, Summary of key rules. https://practicaltypography.com/summary-of-key-rules.html
13. Apple HIG, Buttons. https://developer.apple.com/design/human-interface-guidelines/buttons
14. Material 3 in Compose, colour roles and tonal elevation. https://developer.android.com/develop/ui/compose/designsystems/material3
15. APCA in a Nutshell. https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html
16. Refactoring UI, Building your color palette. https://www.refactoringui.com/previews/building-your-color-palette
17. Material Components, Motion (duration and easing). https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md
18. MDN, prefers-reduced-motion. https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
