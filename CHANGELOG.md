# Changelog

## [1.2.1](https://github.com/NiftyLeague/ftso-feed-value-provider/compare/v1.2.0...v1.2.1) (2025-12-20)


### Bug Fixes

* **ci:** concurrency issues & Binance geo-blocked ([a487bff](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/a487bffcf480bc6cf3bb55877736fe960aa64eef))
* **ci:** enforce script failures, fix unit tests, enhance CCXT filtering. ([a635418](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/a6354185f9ecf44fc863c753d174fc7c703a05db))
* **ci:** potential fixes for remaining script failures ([3e287ac](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/3e287ac65785fe46ba3d5d3bcfb95774cf3d6fb1))
* **ci:** script cleanup process & add DISABLED_CCXT_EXCHANGES for binance ([d7d4fe0](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/d7d4fe0f09b7fccf3fbc866cfed173acb0c41791))
* **load:** ignore memory monitor startup line ([a937c4c](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/a937c4c52a0bdfe278ae5194dd8bc1a2ffb47e18))
* **scripts:** don't treat summary lines as errors ([b496bac](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/b496bacc9f1321558c7f878c4228a4fb62043a0f))

## [1.2.0](https://github.com/NiftyLeague/ftso-feed-value-provider/compare/v1.1.1...v1.2.0) (2025-12-18)


### Features

* **feeds:** Add support for MON/USD ([3961e08](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/3961e08013c3ae5dad0c93c16097b2965448f678))

## [1.1.1](https://github.com/NiftyLeague/ftso-feed-value-provider/compare/v1.1.0...v1.1.1) (2025-12-16)


### Bug Fixes

* **cache:** enhance cache TTL handling and support stale-cache fallback behavior ([011f843](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/011f843132f58b041fb9768dce940d9ffed9b48d))
* enhance connection management & cleanup across services to avoid resource leaks ([a5c9ca4](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/a5c9ca40802e62df48b04474b6cfa1397a5ce4cc))
* **feed:** improve price aggregation and caching logic for feeds ([5c7e651](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/5c7e6519a8307b76ef8d31a75d628a25f36701dc))
* **feed:** return feeds with optional values & add all feeds to swagger default ([43b6024](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/43b60249049daa0b1afe3e04b142def23e22bc5c))
* **integration:** streamline initialization and enhance price update flow handling ([07c7404](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/07c7404dbedc8d8d0686fffd67e607891ab7331a))
* **logging:** adjust log levels to reduce WARN spam and improve clarity ([e7c3c8a](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/e7c3c8aee0c5f56eacaa588ffff2449326359124))
* **tests:** enhance Jest configuration and cleanup for HTTP(S) agents to prevent hanging ([a609233](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/a609233ff2311eecbeb3fca1d17388af7414d636))

## [1.1.0](https://github.com/NiftyLeague/ftso-feed-value-provider/compare/v1.0.0...v1.1.0) (2025-12-11)


### Features

* Enable configuring adapters use by ENV ([#28](https://github.com/NiftyLeague/ftso-feed-value-provider/issues/28)) ([ae30cb3](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/ae30cb3a6e276c7e69847408ac3f20adbcac7af3))
* **health:** Refactor health check endpoints and improve health metrics aggregation ([114f2d4](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/114f2d4153cf04aeaceeceb0bf6bd6245917d5ec))

## 1.0.0 (2025-12-11)

### Features

- Add CI workflow and setup husky/lintstaged
  ([24a133d](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/24a133d5e99f584d8cd46861a6d2483e40081731))
- add mexc source for JOULE
  ([678aa65](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/678aa650bf40d8884f5d5f30c17de7ef07f5bbf4))
- Add new CI job for Jest tests and setup dependabot
  ([c6720af](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/c6720af55901b10ac807dfad067acf0ce1c8381a))
- Add Prometheus metrics endpoint & Grafana dashboard
  ([7bc8280](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/7bc8280fc86858404dc31f2f94e3ac627808548e))
- Add proxy handling to troubleshoot Geo-blokcing by Binance
  ([d34d90f](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/d34d90f269707d1cf84cc8971bd747bd541d7cbb))
- add usdx to example value provider
  ([dc0b130](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/dc0b13095d460091678a948e47d6b19b7d494858))
- calculate median instead of mean for exchange prices
  ([98760e2](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/98760e241aa46e7803f8ddeaeb3fc2285df1a0cc))
- Enhance health endpoints output and readiness checks
  ([41565a9](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/41565a9badeca02b54b2aef601a9273eab19ce70))
- **feeds:** add HBAR, PENGU, HYPE and APT
  ([8be9cbf](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/8be9cbf0f1946e21b67216f14f393647b936f579))
- **feeds:** add op/usd feed
  ([f0355e3](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/f0355e390247f864553d289c713bd5317aabf9f2))
- **feeds:** add PAXG
  ([3d2a53f](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/3d2a53f2234cf16cdd2ebf9d8e1eadb2a2fb165a))
- **feeds:** add S (Sonic, prev FTM)
  ([b77627c](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/b77627c66ab6eba301a4a548602e5823b8203bb4))
- **feeds:** add TRUMP
  ([7a7f2e0](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/7a7f2e0c6f52cc5f2898dc30eeeaeab7ab7fd080))
- Tickers update: remove INJ & MATIC, add XPL
  ([1cde643](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/1cde6434ace4ff6d58a473f2ec2f9fc8867fd629))
- **token:** add PUMP/USD
  ([afaf1db](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/afaf1db989f1b7482363564e5c266893242ecc9a))
- use weighted calculation
  ([8632443](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/8632443fa3dca0b3eb77c39aeca8b09858a4ad0f))
- use weighted median calculation
  ([2dd0942](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/2dd094262d9a2bbf031e6f574765a133bbb6cf3e))

### Bug Fixes

- add kraken exchange for USDT/USD feed
  ([57cfe15](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/57cfe15ac072f5637bcda85a61f397c6777a5077))
- adjust performance monitor test threshold
  ([6da59bf](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/6da59bfbebae8e683c641cd257fe230aae80e9c7))
- code scanning alert
  [#3](https://github.com/NiftyLeague/ftso-feed-value-provider/issues/3)
  polynomial regex
  ([a7905be](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/a7905bec6f7e5b9a02f59d4a4e751e119abb9bab))
- **dockerfile:** use nest assets to inject config, simplify to two stage docker
  build
  ([d337248](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/d337248ab16fbf04f6df722099f260b2c7708ec5))
- **docker:** reduce final image size by 2x
  ([620abc2](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/620abc2f6f3c6cce414b0dd2475afed948e3d706))
- **feeds:** add bingx for HYPE
  ([c9c0787](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/c9c07873cd69b18b8bd4da6bc9273d0a6857070a))
- **feeds:** FTM exchange sources
  ([fb24e1f](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/fb24e1fde989e9fa3ce9663c3c8c94263bb2b37c))
- **feeds:** update exchange lists
  ([1b7dffc](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/1b7dffc3cf607e2b009830a73140faa91ea955a8))
- filter out lower tier exchanges
  ([c550f39](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/c550f394bb228f9905c53ba8f309a86445762e11))
- format with prettier
  ([9f63688](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/9f636884688d868ace9f5a012d03482579f440eb))
- improve exchange lists
  ([58da070](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/58da070aedc71ff9385c13d17b0967b1164113cf))
- improve feeds exchange list
  ([d7be8b6](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/d7be8b6d8a6582bbd6fe64a6d525938772407a19))
- improve logging and circuit breaker configuration for stability
  ([1457732](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/1457732f1554887db75ba3baba0dbea1274ed5e5))
- improve warning messages
  ([b705f8b](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/b705f8bf0a547a989155c4dc290c2d7cba2373e0))
- increase default Docker CPU/Memory limits
  ([cbd481b](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/cbd481bc3b46192e24143ba9e4ecb6bff08af1e9))
- minor issues in Dockerfile
  ([fe19b07](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/fe19b07febc63ae5cca3bf104c81e8273c0e8933))
- **naming:** rename RandomExampleProviderModule to AppModule
  ([4fff45e](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/4fff45eb02d6eebe066343a5f125bd91f7b50637))
- Optimize Docker registry setup & performance
  ([cdd74aa](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/cdd74aafd5f67c09cd5981aed0a1e23192a55117))
- **parsing:** ensure windowSec is integer
  ([fc12d5a](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/fc12d5a1237660514650fdc14f00e3c8c9499844))
- **performance:** cache deps in docker build, add dockerignore
  ([029ea2c](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/029ea2cc341b21b51b6056e9897a7bffc5451959))
- **performance:** load exchanges in parallel, use map for config lookups
  ([d27abbe](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/d27abbe9bee66ef105175d659fbe2845ba8b63b3))
- **performance:** use resolveJsonModule, remove excess usdtToUsd conversions
  ([2454afb](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/2454afba0cefce5489048124c84a803a843b5240))
- pol source on okx
  ([24ee3f9](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/24ee3f9067cd571c09d0312053a47aabb9e82a69))
- pol source on okx
  ([000557d](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/000557d5d2ac5d93593f7cb1a49f3fa4967a9ddd))
- potential fix integration tests in CI
  ([0067207](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/0067207d0c944ab71ce8dfed7708aedf1c024b0a))
- Registry build ignore husky
  ([e68d73f](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/e68d73f69b08602b04757f6758577e5c2411dc22))
- Registry build invalid tag
  ([303acf8](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/303acf8dc42f7f0a282f97e27a833cd56afaabc6))
- remove deprecated exchange pairs
  ([d98532b](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/d98532ba1d6cf54f5e1d8b34d0f009dbf04fb983))
- remove deprecated pairs
  ([fa539a8](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/fa539a89386b3742c8540dca407beb5f03861cca))
- remove deprecated pairs
  ([65db5ef](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/65db5eff450957a50ee2a37e8757c3af288d5ddc))
- remove FTM/USD and DAI/USD feeds
  ([2f5fb1a](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/2f5fb1afb987ffa20f1b9636246c0af85700ec46))
- remove invalid exchange pairs
  ([da3329e](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/da3329e43bcd1e36b5e89c16b891a3882fd8c685))
- remove invalid exchange pairs
  ([40acf50](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/40acf5024f4554235ea9f54796b6c2386998f6f9))
- replace bitfinex with bitfinex2
  ([b54e2e8](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/b54e2e88656dc3cc7fb1e7a58902115722e2cf0f))
- Revert jest tests to standard command
  ([19339b5](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/19339b5a97e2ef11cbb733edf843a5a3d515d27c))
- revert pol/usdc change
  ([5b3d6e2](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/5b3d6e27cbeb45e5f75d12481976b7ea33788f63))
- revert pol/usdc change
  ([0bb3710](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/0bb3710b258a9dfbcfc14ebb8c736f9ad762162e))
- Skip src/adapters/**tests**/integration/ tests in CI
  ([d657bcb](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/d657bcb67d6e034e8f1d5c17df1b2d2eda214ae9))
- update list of exchanges
  ([7818e9c](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/7818e9cbcf883ae914eccebbcc850554c4984403))
- update list of exchanges
  ([7ad79bc](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/7ad79bcc92e04320bc057a5d8ef23d3f0d1c59af))
- update README.md
  ([515c709](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/515c709e080728cab2eac5242a8af22efa88783e))
- use raw median calculation
  ([32c891a](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/32c891a950794d353773ffb62af5a39cf93e74d4))
- **volume:** default window and remove unused imports
  ([ed57772](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/ed5777227beb73af84ac9bd1307ba3641453c87c))
- **volume:** replace Promise.all with loop
  ([a34692a](https://github.com/NiftyLeague/ftso-feed-value-provider/commit/a34692a62e8e8a5954fe9088a2b548246e825aec))
