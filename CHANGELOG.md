# Changelog

All notable changes to AutoApplyMax will be documented in this file.

## [v1.6.0] - 2026-05-22

### ✨ New Features
- **Cooldown auto-resume** — when LinkedIn temporarily throttles the bot ("We noticed you're applying at a fast pace"), the extension now pauses with exponential backoff (90s → 3min → 6min), refreshes the page automatically at the end of the cooldown, verifies Easy Apply is available again, and resumes the automation. Stops cleanly after three consecutive throttles.
- **Throttle-banner detection** — detects LinkedIn's rate-limit dialog by matching the exact wording (`applying at a fast pace`, `briefly paused LinkedIn Apply`, `safeguard against automated inauthentic activities`, etc.) across body text, modals, dialogs, toasts, and inline feedback containers.
- **Pre-flight throttle checks** — the bot now checks for throttle banners at the top of every job iteration AND on the job detail panel, not only after clicking Easy Apply.
- **Disabled-button safeguard** — if LinkedIn renders the Easy Apply button as disabled, the bot treats it as a throttle signal and never clicks it (clicking disabled buttons is a known automation tell).
- **Popup cooldown countdown** — popup status shows `Cooldown (n/3) — Xs` during the wait and `Resuming (n/3)…` while the post-cooldown reload is in flight.

### 🐛 Bug Fixes
- Stop button now works during cooldown. The cooldown wait is split into 1-second ticks that poll an abort flag, so a Stop press breaks the loop immediately instead of waiting for the timer to expire.
- Page now reloads at the end of the cooldown (in addition to the reload at the start), giving the resume logic a freshly painted DOM to probe.

### 🔧 Technical Improvements
- All French and other non-English comments and log strings translated to English. Functional multilingual matchers (regex for `années`/`años`/`jahre`, button-label arrays for `Terminé`/`Fertig`/`完了`, throttle phrases for FR/ES/DE) are preserved.
- Cooldown state now uses two storage flags (`cooldownPending`, `cooldownReadyToResume`) for the two-reload cycle, with a 30-minute staleness guard so a closed-then-reopened tab can't accidentally resume.
- Cooldown retry counter resets to 0 after each successful application so isolated throttles do not pre-escalate later ones.
- README rewritten for clarity (concise, professional, GitHub-focused).

## [v1.5.0] - 2026-01-15

### ✨ New Features
- **LinkedIn Collections Support** - Now works on `/jobs/collections/` pages (saved jobs, recommended jobs, etc.) with infinite scroll
- **Smart Resume Selection** - Now selects existing/previously uploaded CV instead of re-uploading for each application. Only uploads once (first application), then reuses the CV.

### 🐛 Bug Fixes
- Removed redundant "Welcome aboard!" toast message after onboarding
- Fixed fadeOut animation for onboarding overlay closure
- Fixed resume being uploaded for every single application (now uploads once, then selects existing)

### 🔧 Technical Improvements
- Collections support uses conditional selectors (only on collections pages, doesn't affect search pages)
- Infinite scroll pagination for collections pages
- Standard pagination preserved for search pages

## [v1.0.0] - 2024-10-28

### 🎉 Initial Release

#### ✨ Features
- **Automated LinkedIn Easy Apply** - One-click job applications
- **Smart Form Filling** - Automatically fills application forms
- **Human-like Behavior** - Random delays and natural interactions
- **Blacklist System** - Skip jobs with unwanted keywords
- **Daily Limit Detection** - Automatically stops when LinkedIn limit is reached
- **Session Persistence** - Resume where you left off after browser restart
- **Application Tracking** - Real-time statistics (applied/skipped/errors)
- **CSV Export** - Download applied jobs data
- **Applied Jobs Tab** - View application history in extension popup

#### 🎨 UI/UX
- Clean, modern interface with LinkedIn color scheme
- Discord community card with direct link
- Three tabs: Personal Info, Settings, Applied Jobs
- Gradient button colors:
  - **Save Config**: Light blue (#e8f4f8 → #d4e9f2)
  - **Stop**: Light red (#fee2e2 → #fecaca)
  - **Export**: Light green (#d1fae5 → #a7f3d0)
  - **Reset**: Light orange (#fed7aa → #fdba74)
- Job cards with company, location, and time ago
- Empty state for no applications

#### 🤖 Automation
- Multi-selector element detection (XPath + CSS)
- Retry mechanism (up to 3 attempts)
- Automatic stuck detection (2-minute timeout)
- Form intelligence for various LinkedIn form types
- Error recovery and continuation

#### 🔒 Security & Privacy
- 100% local data storage
- No external servers
- LinkedIn-only permissions
- Open source and transparent

#### 💬 Community
- Discord integration (https://discord.gg/xWaCXBZbws)
- Twitter presence (@Azo92i)
- Community-driven development
- Feature voting and feedback

#### 📚 Documentation
- Professional README with roadmap
- Installation guide
- Usage guide
- Troubleshooting section
- Contributing guidelines
- Icon generation guide
- Next steps guide
- Google Sheets integration guide (future)

### 🐛 Bug Fixes
- Fixed daily limit detection with multiple message patterns
- Improved button state synchronization
- Better error handling for failed applications

### 🚀 Coming Soon (Roadmap)

#### v1.1.0 - AI Integration
- AI-powered job matching
- Google Sheets auto-export
- Success rate tracking

#### v1.2.0 - CV & Cover Letters
- Dynamic CV adaptation for each job
- AI-generated cover letters
- Multi-format resume support

#### v1.3.0 - Multi-Platform
- Indeed support
- Glassdoor support
- Company career page auto-apply

#### v1.4.0 - Advanced Analytics
- Application success rates
- Response time tracking
- Industry insights
- A/B testing features

---

## Version History

- **v1.0.0** - 2024-10-28 - Initial release 🎉

---

## Upgrade Guide

### From Nothing to v1.0.0
Fresh install - follow [Installation Guide](README.md#installation)

---

## Breaking Changes

None yet - this is the first release!

---

## Contributors

- Initial development and design
- Community feedback and testing

**Want to contribute?** See [CONTRIBUTING.md](CONTRIBUTING.md)

---

## Links

- 💬 [Discord Community](https://discord.gg/xWaCXBZbws)
- 🐦 [Twitter @Azo92i](https://twitter.com/Azo92i)
- 🐛 [Report Issues](https://github.com/yourusername/AutoApplyMax/issues)
- ⭐ [GitHub Repo](https://github.com/yourusername/AutoApplyMax)
