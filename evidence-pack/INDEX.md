# ISO Evidence Pack Index

Project name: OpenAIP

Evaluation build:
- Staging URL:
- Commit hash / tag:
- Date:
- Supabase project ref (staging):
- Render service (staging):
- Vercel preview deployment:

## A. Functional Suitability

### What we will show

- Core user journeys complete successfully and match documented requirements.
- Functional behavior is stable across primary roles and critical pages.

### Artifacts

- `./01-functional/playwright-report/`
- `./01-functional/screenshots/`

### Checklist

- [ ] Playwright report generated (date)
- [ ] Critical user journey screenshots captured
- [ ] Functional defects triaged with references

## B. Performance Efficiency

### What we will show

- Page load and interaction performance are within accepted targets.
- System behavior under expected load is measured and documented.

### Artifacts

- `./02-performance/lighthouse/`
- `./02-performance/k6/`
- `./02-performance/logs/`

### Checklist

- [ ] Lighthouse reports exported
- [ ] k6 load test results exported
- [ ] Performance logs archived with timestamps

## C. Compatibility

### What we will show

- Application functions correctly across supported browsers and device classes.
- Display and behavior remain consistent for key workflows.

### Artifacts

- `./03-compatibility/browser-matrix/`
- `./03-compatibility/real-device-screenshots/`

### Checklist

- [ ] Browser compatibility matrix updated
- [ ] Real-device screenshots captured
- [ ] Compatibility gaps documented with severity

## D. Interaction Capability

### What we will show

- User interactions are understandable, accessible, and recoverable from common mistakes.
- Error messaging and input protections support task completion.

### Artifacts

- `./04-interaction/a11y/`
- `./04-interaction/task-runs/`
- `./04-interaction/error-protection/`

### Checklist

- [ ] Accessibility scan or audit exported
- [ ] Task-run evidence captured for representative users
- [ ] Error prevention and validation behavior documented

## E. Reliability

### What we will show

- Service availability and fault handling meet expected reliability goals.
- Recovery behavior is tested and evidence is reproducible.

### Artifacts

- `./05-reliability/uptime/`
- `./05-reliability/sentry/`
- `./05-reliability/recovery-drill/`

### Checklist

- [ ] Uptime evidence exported
- [ ] Error tracking summaries archived
- [ ] Recovery drill execution and results documented

## F. Security

### What we will show

- Security controls are tested for dependency, application, and data-access layers.
- Findings are tracked and remediations are linked.

### Artifacts

- `./06-security/dependency-audit/`
- `./06-security/zap/`
- `./06-security/rls-tests/`
- `./06-security/audit-trail/`

### Checklist

- [ ] Dependency audit report exported
- [ ] ZAP scan artifacts exported
- [ ] RLS tests executed with evidence
- [ ] Security-relevant audit trail samples captured

## G. Maintainability

### What we will show

- Build quality, test quality, and change-readiness are visible and repeatable.
- CI outcomes and coverage trends are documented per evaluation build.

### Artifacts

- `./07-maintainability/ci/`
- `./07-maintainability/coverage/`
- `./07-maintainability/test-inventory/`

### Checklist

- [ ] CI run summaries archived
- [ ] Coverage artifacts exported
- [ ] Test inventory updated for this evaluation build

## H. Flexibility

### What we will show

- The system supports controlled deployment and adaptation to staging conditions.
- Configuration and release history are traceable.

### Artifacts

- `./08-flexibility/staging-setup/`
- `./08-flexibility/deploy-history/`

### Checklist

- [ ] Staging setup notes updated
- [ ] Deployment history evidence attached
- [ ] Environment-specific adjustments documented

## I. Safety

### What we will show

- Failure containment, throttling, and graceful degradation behaviors are implemented and verified.
- Safety mechanisms reduce harmful system outcomes during abnormal conditions.

### Artifacts

- `./09-safety/failsafe/`
- `./09-safety/rate-limit/`
- `./09-safety/degradation/`

### Checklist

- [ ] Failsafe behavior evidence captured
- [ ] Rate-limit behavior evidence captured
- [ ] Degradation scenario evidence captured
