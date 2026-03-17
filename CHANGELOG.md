# [1.10.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.9.0...v1.10.0) (2026-03-17)


### Bug Fixes

* add missing x402 and transport deps to E2E test ([dc28029](https://github.com/TheCryptoDonkey/satgate/commit/dc28029be0b207b80a775b9d8f18e7c7c684ecc0))
* update AuthMiddlewareConfig for cashu auth mode, revert cli.ts ([5df9738](https://github.com/TheCryptoDonkey/satgate/commit/5df9738134a02e6b610b708b4a3a57a049fc6484))


### Features

* add --cashu-mints/--cashu-unit CLI flags and Cashu Nostr announcement ([f9c1faf](https://github.com/TheCryptoDonkey/satgate/commit/f9c1fafa288ef22a6891ccf72b5c7445cecc1220))
* add Cashu ecash config parsing and auth mode inference ([8dba32d](https://github.com/TheCryptoDonkey/satgate/commit/8dba32dbc96d07b3902ac83b9c431fc6a19e4dc2))
* add Cashu metadata to well-known and llms.txt discovery ([91a9341](https://github.com/TheCryptoDonkey/satgate/commit/91a9341a4c45b92bfbfedc295b02aef33b229ae0))
* wire xcashu rail, fix paymentMethods, broaden auth for Cashu ([3ca5436](https://github.com/TheCryptoDonkey/satgate/commit/3ca54366dc7b7cacdbeafc4dbbf59f08981aebc0))

# [1.9.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.8.0...v1.9.0) (2026-03-15)


### Features

* add --public-url flag for explicit announce URL ([bb9b186](https://github.com/TheCryptoDonkey/satgate/commit/bb9b186b295d9c6dba955209875f31bc2ac4eb2e))

# [1.8.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.7.8...v1.8.0) (2026-03-15)


### Features

* bump toll-booth to ^3.3.0 for credit_tiers and custom top-ups ([51f8353](https://github.com/TheCryptoDonkey/satgate/commit/51f83533f4d74045f9865ea2a4f5d8063fe39d98))

## [1.7.8](https://github.com/TheCryptoDonkey/satgate/compare/v1.7.7...v1.7.8) (2026-03-15)


### Bug Fixes

* add absolute stream duration cap and guard capacity slot leak ([43eeceb](https://github.com/TheCryptoDonkey/satgate/commit/43eeceb4dbe6d972874746ef39bae73d2695050c))
* guard controller.close() in timer callbacks and sanitise array elements in logger ([5d19591](https://github.com/TheCryptoDonkey/satgate/commit/5d195919d02c6cc23a9c88988ca11db39fee9850))
* prevent facilitator redirect-based SSRF and add error handling ([633936f](https://github.com/TheCryptoDonkey/satgate/commit/633936f2fcf828ad8ea734cdb25187bbdd32cfe8))
* reject empty credentials in allowlist auth ([d24701e](https://github.com/TheCryptoDonkey/satgate/commit/d24701ec0db747325d7f43e1e4c6ac479064dff5))
* sanitise nested objects in JSON logger context ([b1df041](https://github.com/TheCryptoDonkey/satgate/commit/b1df0418b4ca947cd9250958427593efc180d212))
* use canonical cwd for allowlist file containment check ([65d5ea7](https://github.com/TheCryptoDonkey/satgate/commit/65d5ea770ced9c808b3e6e8ba625defccdf83487))

## [1.7.7](https://github.com/TheCryptoDonkey/satgate/compare/v1.7.6...v1.7.7) (2026-03-15)


### Bug Fixes

* add body-read deadline, facilitator size cap, upstream URL hardening ([c566a33](https://github.com/TheCryptoDonkey/satgate/commit/c566a33bc848d88a389787366af2c4af9ca3d1a2))
* canonicalise cwd in dbPath check for symlinked working directories ([a2cb859](https://github.com/TheCryptoDonkey/satgate/commit/a2cb85978414cdc0a5c995eea5080e0cc4fbe3e0))
* defer replay cache eviction until after NIP-98 authentication ([84482ef](https://github.com/TheCryptoDonkey/satgate/commit/84482ef1d1b1cb0bc5770f9852e0b23adc83c084))
* harden NIP-98 verification, case-normalise pubkeys, improve replay cache ([3a58432](https://github.com/TheCryptoDonkey/satgate/commit/3a584325fb3ee2fb98037aad93d10ba40ef56328))
* prevent prototype pollution in pricing, validate config bounds, add token byte floor ([bc15608](https://github.com/TheCryptoDonkey/satgate/commit/bc15608f3e5b5b79c3139d4fc03a669389c9110c))
* race body reads against AbortSignal to interrupt stalled clients ([553f0fc](https://github.com/TheCryptoDonkey/satgate/commit/553f0fcbeec966cdfc4f777e7b620df6a165f174))
* re-review fixes — resolve dbPath fully, remove redundant size check, guard facilitator JSON ([4f8a6a2](https://github.com/TheCryptoDonkey/satgate/commit/4f8a6a2cf0017f3ef04469b642e985d0a60f93ba))
* reconcile Lightning payment on body-read timeout and failure ([9634876](https://github.com/TheCryptoDonkey/satgate/commit/96348765dcb7a08eff883b349af8c72811a61db8))
* resolve dbPath fallback relative to canonical cwd ([9fe0781](https://github.com/TheCryptoDonkey/satgate/commit/9fe07812a2011ac11c0342f35fea240dfff125a3))

## [1.7.6](https://github.com/TheCryptoDonkey/satgate/compare/v1.7.5...v1.7.6) (2026-03-15)


### Bug Fixes

* sanitise JSON logger values, add body-read deadline, prevent models cache poisoning ([d6cbb7c](https://github.com/TheCryptoDonkey/satgate/commit/d6cbb7cfa661f4b1d55e55be47ee98b2d558e4a6))

## [1.7.5](https://github.com/TheCryptoDonkey/satgate/compare/v1.7.4...v1.7.5) (2026-03-15)


### Bug Fixes

* cancel upstream on client disconnect, defer capacity until body parsed ([1e8ecf0](https://github.com/TheCryptoDonkey/satgate/commit/1e8ecf0a78537153ad800ac58e5467e67fab9d77))
* complete log sanitisation coverage, align demo health endpoint ([babd904](https://github.com/TheCryptoDonkey/satgate/commit/babd904d2a25e990ecb5bc2353d44676e705dd83))
* security audit hardening — response limits, input validation, log injection ([f2b8c69](https://github.com/TheCryptoDonkey/satgate/commit/f2b8c69edd63fe67bf58b33aa540eddf1b15a682))

## [1.7.4](https://github.com/TheCryptoDonkey/satgate/compare/v1.7.3...v1.7.4) (2026-03-15)


### Bug Fixes

* bill completion tokens for non-streaming responses, harden streaming token counting ([fa74342](https://github.com/TheCryptoDonkey/satgate/commit/fa743427916548ccd0fe566bbd33af7a4fe93091))
* harden config validation, path-scope allowlist-file, warn on open+tunnel ([c917590](https://github.com/TheCryptoDonkey/satgate/commit/c91759020a1055ec39593e990c1d26e8f158c6b2))
* prevent JSON log field overwrite by spreading event data before explicit fields ([a6668c5](https://github.com/TheCryptoDonkey/satgate/commit/a6668c5f12a4bff0f0c626157aa28b7d506c137c))
* read non-streaming upstream response incrementally to enforce size limit ([2c32b2e](https://github.com/TheCryptoDonkey/satgate/commit/2c32b2e6c39e3a96d8ded3278cd59fd148b9c63d))
* reject NIP-98 events when seen-ID cache is at capacity after pruning ([bf21b69](https://github.com/TheCryptoDonkey/satgate/commit/bf21b69f7b14a461fb0470b968bc20a00e51e4aa))
* resolve symlinks in allowlist-file path check, add negative pricing tests ([b2b68c1](https://github.com/TheCryptoDonkey/satgate/commit/b2b68c18e1e6811a2fb4b4c0dfd2e49bb31f46d5))

## [1.7.3](https://github.com/TheCryptoDonkey/satgate/compare/v1.7.2...v1.7.3) (2026-03-14)


### Bug Fixes

* upgrade GitHub Actions to v6 (Node.js 24), bump 402-announce to 1.1.2 ([509894c](https://github.com/TheCryptoDonkey/satgate/commit/509894ce2718644ccca60a8b35eb58318f96cb53))

## [1.7.2](https://github.com/TheCryptoDonkey/satgate/compare/v1.7.1...v1.7.2) (2026-03-14)


### Bug Fixes

* warn when secrets are passed on the command line ([a357a47](https://github.com/TheCryptoDonkey/satgate/commit/a357a478d65a80a9fd14f6cf62554431d381bed3))

## [1.7.1](https://github.com/TheCryptoDonkey/satgate/compare/v1.7.0...v1.7.1) (2026-03-14)


### Bug Fixes

* add Content-Security-Policy and Permissions-Policy headers ([887b45a](https://github.com/TheCryptoDonkey/satgate/commit/887b45ac652e9a5992c105ba7dbfc9630b70b2e5))
* add streaming size limit, pre-check upstream Content-Length, remove hop-by-hop header ([ad750af](https://github.com/TheCryptoDonkey/satgate/commit/ad750afe56434154a36905718e23d91de955538d))
* address re-review findings — cap seen-ID cache, add stream error event ([45074be](https://github.com/TheCryptoDonkey/satgate/commit/45074bef7040f1522ae5ef43e1c433dfd17358de))
* enforce rootKey minimum entropy, restrict announceKey directory permissions ([ffc8b05](https://github.com/TheCryptoDonkey/satgate/commit/ffc8b057467d7eeff45214361c3a89372b9fea0f))
* harden auth — HMAC-based timing-safe comparison, NIP-98 replay prevention, case-insensitive hex pubkeys ([c8bc50c](https://github.com/TheCryptoDonkey/satgate/commit/c8bc50cfae77e7f4545543b775a9327d858f7952))
* pass maxBodySize to streaming proxy instead of using hardcoded 100 MiB ([18ae958](https://github.com/TheCryptoDonkey/satgate/commit/18ae95827341c71f4864c4577678f9e9a7e0c03d))
* require rootKey to be exactly 64 hex chars, matching toll-booth ([79ceb2a](https://github.com/TheCryptoDonkey/satgate/commit/79ceb2a7974bcc2970f57de566b9219d98581802))

# [1.7.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.6.0...v1.7.0) (2026-03-14)


### Bug Fixes

* correct integration test exclude pattern in CI ([70c6abe](https://github.com/TheCryptoDonkey/satgate/commit/70c6abe54671d1406107a8abaa884f095cf2b3ba))
* regenerate lockfile to resolve 402-announce from npm registry ([5554825](https://github.com/TheCryptoDonkey/satgate/commit/555482511c116b21af0ef7d526ffca1cabe9cbe3))
* regenerate lockfile with cross-platform optional deps ([380bd82](https://github.com/TheCryptoDonkey/satgate/commit/380bd826fc407b9dd047e101e2ed6570231a2899))
* stop logging secret key, write to file with restricted permissions ([788f4e3](https://github.com/TheCryptoDonkey/satgate/commit/788f4e369c6776846c1331fb2dab81b91611dc7e))
* use npm registry for 402-announce, fix announcement type narrowing ([cb4e077](https://github.com/TheCryptoDonkey/satgate/commit/cb4e07799c7e09b066a0ca69bdaf471bbf347cb4))


### Features

* add --announce config options ([4834af2](https://github.com/TheCryptoDonkey/satgate/commit/4834af2672a75974d93d32bdb44832286f99cfe4))
* add --announce for Nostr discovery via l402-announce ([0d23a48](https://github.com/TheCryptoDonkey/satgate/commit/0d23a48abe603cdf6ca917dc79d021a1a6ae0f00))
* add status tag and JSON schemas to Nostr service announcement ([1495451](https://github.com/TheCryptoDonkey/satgate/commit/14954513838173b233f3585d1e6e24580b14aca3))

# [1.6.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.5.1...v1.6.0) (2026-03-14)


### Features

* enable npm publishing ([af0735c](https://github.com/TheCryptoDonkey/satgate/commit/af0735c29474ea60374ff69a1a5bd17109102968))
* remove IP addresses from log output ([4197d68](https://github.com/TheCryptoDonkey/satgate/commit/4197d68d840cd80590826daa7590273bd8cba752))

## [1.5.1](https://github.com/TheCryptoDonkey/satgate/compare/v1.5.0...v1.5.1) (2026-03-14)


### Bug Fixes

* add spacing between payment tier buttons and actions ([9100278](https://github.com/TheCryptoDonkey/satgate/commit/91002785092d29c71818d170c2c1f0eb0c9e4cd4))

# [1.5.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.4.0...v1.5.0) (2026-03-14)


### Features

* add custom sats amount option to payment flow ([f3b9e68](https://github.com/TheCryptoDonkey/satgate/commit/f3b9e68439c859ab83340782fcea31f29d3ce0e5))

# [1.4.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.3.1...v1.4.0) (2026-03-14)


### Features

* streamline payment flow — auto-load QR code like sats-for-laughs ([8d80fee](https://github.com/TheCryptoDonkey/satgate/commit/8d80fee4f0a50a329aaae45a1c98ebd249333090))

## [1.3.1](https://github.com/TheCryptoDonkey/satgate/compare/v1.3.0...v1.3.1) (2026-03-14)


### Bug Fixes

* show tokens/sat instead of sats/1k tokens on model cards ([2ba5714](https://github.com/TheCryptoDonkey/satgate/commit/2ba5714dafe1e7ca4f4bdbd7c8a84c79ae68437f))

# [1.3.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.2.1...v1.3.0) (2026-03-14)


### Features

* replace pricing chips with model selector cards ([540bbdb](https://github.com/TheCryptoDonkey/satgate/commit/540bbdba2586459c4105b45f28a9c9457e43cdf7))

## [1.2.1](https://github.com/TheCryptoDonkey/satgate/compare/v1.2.0...v1.2.1) (2026-03-14)


### Bug Fixes

* model selector UX improvements ([9a22de3](https://github.com/TheCryptoDonkey/satgate/commit/9a22de36521b17561a98c61879ac77388ab36aa6))

# [1.2.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.1.0...v1.2.0) (2026-03-14)


### Bug Fixes

* show sats balance for paid users instead of estimated tokens ([f64f6dd](https://github.com/TheCryptoDonkey/satgate/commit/f64f6dd85d23fd6d1e389f09aa80c4a9e2f72dd5))


### Features

* add gemma3:4b as second model with per-model pricing ([0c5eab6](https://github.com/TheCryptoDonkey/satgate/commit/0c5eab630fa031b93f7fdc78c428574d79b30938))
* add model selector pills to UI ([7bb3c49](https://github.com/TheCryptoDonkey/satgate/commit/7bb3c49e200566f735c75806b7aceb9fbc29e84c))

# [1.1.0](https://github.com/TheCryptoDonkey/satgate/compare/v1.0.0...v1.1.0) (2026-03-14)


### Features

* switch free tier from per-request to per-usage (creditsPerDay) ([3aec2b3](https://github.com/TheCryptoDonkey/satgate/commit/3aec2b340d08b94b383dfe6e3998c1b7ce27ef17))

# 1.0.0 (2026-03-14)


### Bug Fixes

* address code review findings ([676242c](https://github.com/TheCryptoDonkey/satgate/commit/676242ccb0ec258c64462249c61c2810f34e0646))
* cache /v1/models response, validate upstream URL scheme ([4f46f3b](https://github.com/TheCryptoDonkey/satgate/commit/4f46f3b1d9814762f191e786367e8baec7dbf36f))
* disable npm publish and fetch tags in CI ([deb04d4](https://github.com/TheCryptoDonkey/satgate/commit/deb04d4f487d9ce3239b6f194628f1a984770dab))
* exclude reasoning tokens from billing ([2bf1d4c](https://github.com/TheCryptoDonkey/satgate/commit/2bf1d4cfbbfddd98ddd1bb64552d9051257bcac6))
* extract perThousandTokens from pricing objects in landing page chips ([99b5757](https://github.com/TheCryptoDonkey/satgate/commit/99b5757397bcc6901985d18890359ca91d6d05a5))
* grep exact http-password line to avoid concatenating limited-access password ([45e5afd](https://github.com/TheCryptoDonkey/satgate/commit/45e5afd96005435964a93fb6d877a0d97aa9f949))
* harden security — timing-safe auth, input validation, Content-Type checks ([a5731e3](https://github.com/TheCryptoDonkey/satgate/commit/a5731e35cc0a2a4a1cb8361c3d34cfda2f23e853))
* landing page credit persistence, free tier sync, hold display ([98e69f7](https://github.com/TheCryptoDonkey/satgate/commit/98e69f7fd832a459afbd0016e306d4d045dd8f38))
* load allowlist file before config validation so --allowlist-file works standalone ([89e2de9](https://github.com/TheCryptoDonkey/satgate/commit/89e2de99393f6a67e4abbb145d80354ba1d02988))
* merge security-review — add models cache, stream inactivity timeout ([edee94a](https://github.com/TheCryptoDonkey/satgate/commit/edee94a25495c7c19d29456bb3a9b1c4e6ff0b79))
* move status bar inside chat box and show balance on page load ([3e176a6](https://github.com/TheCryptoDonkey/satgate/commit/3e176a69849d4ebe5ddf3f59223ad90ce2b6ac82))
* move toll headers to post-handler middleware ([f1eae63](https://github.com/TheCryptoDonkey/satgate/commit/f1eae6326c6d17441f097e7d9a51e68b501ecfb8))
* pass x402 config to discovery generators in server.ts ([4ba6bec](https://github.com/TheCryptoDonkey/satgate/commit/4ba6bec0d86ce2f826fbfcd24b3828d1df49a291))
* prevent OOM, stream timeouts, auth mode validation ([240bda6](https://github.com/TheCryptoDonkey/satgate/commit/240bda63fb8ec5e565f93c10c2dc979c75e998ee))
* quote jq filter to prevent zsh glob expansion ([22583b5](https://github.com/TheCryptoDonkey/satgate/commit/22583b5f1972533b66c74fabb5d8a4f5998e81d0))
* remove free request counter from status bar, only show token balance for paid credit ([9cf4617](https://github.com/TheCryptoDonkey/satgate/commit/9cf4617d8b351b75c666a9a4f663963c08c6b661))
* remove hardcoded VPS IP from deploy script ([0239897](https://github.com/TheCryptoDonkey/satgate/commit/0239897be55fefce718c799258a3a0891127240d))
* rename remaining Token Toll references to satgate in discovery endpoints ([15109be](https://github.com/TheCryptoDonkey/satgate/commit/15109be149a1f08a52a1beda54b5144941dffaf6))
* reset free token budget daily instead of per session ([2b8ce41](https://github.com/TheCryptoDonkey/satgate/commit/2b8ce41f6580a0874135ed509e83eda58721de4a))
* security hardening — error sanitisation, response limits, config validation ([cf68d3b](https://github.com/TheCryptoDonkey/satgate/commit/cf68d3b5739ed4231474c6e381104678acd72f72))
* security hardening — stream leak, upstream timeout, input validation ([069b41f](https://github.com/TheCryptoDonkey/satgate/commit/069b41fa3a488f5f59f69bbb1577462649f35d21))
* security hardening — timing-safe secrets, upstream timeouts, input validation ([3f7cbd9](https://github.com/TheCryptoDonkey/satgate/commit/3f7cbd9ae7374eabe5bc9dc56856f6e79f06f0b9))
* show payment overlay immediately when free tokens run out during streaming ([ed1e1bb](https://github.com/TheCryptoDonkey/satgate/commit/ed1e1bbd9ca0511a1250eb2160f9ccdbc8bc112a))
* show token balance instead of sats in status bar, convert using model pricing ([c516fba](https://github.com/TheCryptoDonkey/satgate/commit/c516fbae61d93e052b7885fc9fcda91c8a58af52))
* stop legacy token-toll container in deploy script ([21b0c74](https://github.com/TheCryptoDonkey/satgate/commit/21b0c74f55c2ad41049b4b78debf13faa6f6b3a6))
* use dynamic UID for data dir ownership in deploy script ([930527f](https://github.com/TheCryptoDonkey/satgate/commit/930527fa2e457e13566fd2cd0cf4a34a36d2ce6a))
* use Hono c.header() for credit balance headers ([bfc8eda](https://github.com/TheCryptoDonkey/satgate/commit/bfc8edab08826bedd3df82abac62495c27ebe767))
* use Node 24 LTS, exclude local-only integration test in CI ([1abea8b](https://github.com/TheCryptoDonkey/satgate/commit/1abea8b6baab88c39babdd6a38dc855ceeb6db72))
* use published toll-booth package from npm ([0c4999c](https://github.com/TheCryptoDonkey/satgate/commit/0c4999c0c02bc37193ad5fe0d91835076975fccf))


### Features

* add --token-price and --model-price CLI flags and CliArgs fields ([e53e471](https://github.com/TheCryptoDonkey/satgate/commit/e53e4717cb0b6eb2a8dfc7d6fb0bab204efe0291))
* add AI proxy handler with streaming and non-streaming support ([c27d7eb](https://github.com/TheCryptoDonkey/satgate/commit/c27d7eb1ec4634e823ea4dcdfd3b47908ec38beb))
* add allowlist identity checker with Bearer secret support ([d9df302](https://github.com/TheCryptoDonkey/satgate/commit/d9df3021054ffe4384935c024e1b20501b8d4971))
* add auth middleware with open/lightning/allowlist routing ([d3b48d9](https://github.com/TheCryptoDonkey/satgate/commit/d3b48d9cb9f0bb4214ec70974f62323d5b3ad03c))
* add CLI entry point with arg parsing and startup banner ([e227cd2](https://github.com/TheCryptoDonkey/satgate/commit/e227cd2d163fac29cc8478d605ea4e7fe87eeb8e))
* add cloudflare tunnel manager with auto-detect and URL parsing ([c8c1b7c](https://github.com/TheCryptoDonkey/satgate/commit/c8c1b7cfa47b8691d3b499557d19d5c34591d2ab))
* add concurrent request capacity tracker ([64876d1](https://github.com/TheCryptoDonkey/satgate/commit/64876d1665c863a7e65d110012cef4c40c9b9453))
* add config module with layered loading ([023156f](https://github.com/TheCryptoDonkey/satgate/commit/023156fd2ce5a7be7826e156d59e625b6df576d3))
* add demo server with mock Lightning for VHS recording ([7975a2e](https://github.com/TheCryptoDonkey/satgate/commit/7975a2efb5cc86f493a1aaeae9faf5bcdcc80985))
* add Dockerfile, .dockerignore, and Hetzner deploy script ([efd3624](https://github.com/TheCryptoDonkey/satgate/commit/efd36245a66ffe257f08a14d6dbbc0a6b16dc562))
* add GET / route to serve landing page ([c934705](https://github.com/TheCryptoDonkey/satgate/commit/c934705964f17f33510584f30ac6e89fb0395449))
* add Hono server with payment, proxy, and discoverability routes ([cc2a1f7](https://github.com/TheCryptoDonkey/satgate/commit/cc2a1f79410febccb8431e21e17794d3f8fdf534))
* add L402 discoverability endpoints (well-known, llms.txt, OpenAPI) ([74290c8](https://github.com/TheCryptoDonkey/satgate/commit/74290c8f3dbb9ae501e37344523bdb68710a870a))
* add lightning backend factory for phoenixd, lnbits, lnd, cln ([cd6cbb2](https://github.com/TheCryptoDonkey/satgate/commit/cd6cbb2867203957a174737dfe446f9c0cd13f9f))
* add logger module with pretty and JSON formatters ([45fd4ee](https://github.com/TheCryptoDonkey/satgate/commit/45fd4ee6e967d0e8cf4b6f6917337d7648ded13e))
* add model pricing resolution module ([c6d3bac](https://github.com/TheCryptoDonkey/satgate/commit/c6d3bacd08226016ce7d601eba3b30a450608e6b))
* add NIP-98 schnorr verification for Nostr pubkey allowlist ([cd1853f](https://github.com/TheCryptoDonkey/satgate/commit/cd1853fec8ead4d4d0aa6191ccfd1f986e613b49))
* add satgate landing page with chat playground ([dd77bd7](https://github.com/TheCryptoDonkey/satgate/commit/dd77bd73134a7c9d5463367929b1806088204c25))
* add serviceName config and forward toll-booth context headers ([b1bf358](https://github.com/TheCryptoDonkey/satgate/commit/b1bf35884f2674d59e30e308697e669f58e7a072))
* add SSE streaming proxy with token counting ([951c938](https://github.com/TheCryptoDonkey/satgate/commit/951c93832a58f9f409826efb265e7b37b848fda3))
* add token counter with SSE and buffered usage extraction ([ed11bfa](https://github.com/TheCryptoDonkey/satgate/commit/ed11bfa30c0aaaa7df534dbe8a73b5e1ecae8611))
* add verbose and logFormat config fields ([d9ab222](https://github.com/TheCryptoDonkey/satgate/commit/d9ab22208bd1103e4bdd1d94382930f0cf3abcdc))
* add VHS tape and hero recording GIF ([5054572](https://github.com/TheCryptoDonkey/satgate/commit/5054572bbed31725cda8a14f412752203fb0c81c))
* add x402 configuration surface (env vars, YAML) ([d5576ec](https://github.com/TheCryptoDonkey/satgate/commit/d5576ec14f6a4b1b310115a4d76f0cb6b8ff8ec1))
* count down tokens in real time as response streams in ([573e83f](https://github.com/TheCryptoDonkey/satgate/commit/573e83f5e6d71d9b26f54a575f5f05eadf6b7264))
* create logger in CLI, replace console.log startup banner ([e4cfde4](https://github.com/TheCryptoDonkey/satgate/commit/e4cfde49ee81413e24818c8154e1f37ad6afaeb3))
* expose free tier in discovery endpoint and show balance on page load ([0ecb2c9](https://github.com/TheCryptoDonkey/satgate/commit/0ecb2c926fbd385ba61142a265c7510dbaa6074a))
* extend config with lightning, auth, pricing, and tunnel fields ([33f1ae9](https://github.com/TheCryptoDonkey/satgate/commit/33f1ae9081669f10741e670d680c35055d6f9feb))
* finalise public API exports ([ee357e4](https://github.com/TheCryptoDonkey/satgate/commit/ee357e4ddd574d79aac76dc2b328f167d5901a42))
* implement per-token CLI pricing in loadConfig ([1255fd8](https://github.com/TheCryptoDonkey/satgate/commit/1255fd8ff071221b000f7d2bb32cdb9bb132163c))
* rename token-toll to satgate ([2df3d9f](https://github.com/TheCryptoDonkey/satgate/commit/2df3d9f3b53aafdd28191dd8c05aea5f6fe4dcd5))
* scaffold token-toll repository ([f1ea7ab](https://github.com/TheCryptoDonkey/satgate/commit/f1ea7ab1eda88d8b438966de29e59a01c07703f5))
* thread lightning backend to toll-booth and add flat pricing mode ([fd1f052](https://github.com/TheCryptoDonkey/satgate/commit/fd1f052e7e1891fbf6abbfb253d76a5857ae6337))
* track free token budget with real usage countdown, trigger payment when exhausted ([c26f4ca](https://github.com/TheCryptoDonkey/satgate/commit/c26f4ca7bb98675d3d4d4dfe0f74784813c91063))
* update CLI with lightning, auth, tunnel, YAML, and Ollama auto-detect ([2354f0c](https://github.com/TheCryptoDonkey/satgate/commit/2354f0c173d86c86e71ef0cbc22a3d64e7ae59a7))
* update discovery endpoints for x402 payment method ([ff9d69f](https://github.com/TheCryptoDonkey/satgate/commit/ff9d69fc6aad51c19244d01cf782dc96cf41f9b0))
* update exports and package.json for npm publish ([a367eb4](https://github.com/TheCryptoDonkey/satgate/commit/a367eb434c5a1d48a1873273e8b659e1b47e461d))
* wire logger to server and proxy handler ([ce2a985](https://github.com/TheCryptoDonkey/satgate/commit/ce2a985f840ca9bae54f3e724a2702a3664f0052))
* wire x402 into token-toll server ([54426b8](https://github.com/TheCryptoDonkey/satgate/commit/54426b8239323eba931a6b1641b047246778d21a))
