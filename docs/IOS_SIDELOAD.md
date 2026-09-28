> **语言 / Language:** 中文 · [English](IOS_SIDELOAD.en.md)

# 使用 IPA 安装 iPhone App

适用于已有 iPhone、但没有 Mac 或不想自行编译的用户。需要 iOS 17 或更新版本。
本项目提供 **未签名 IPA**，由安装工具使用你自己的 Apple 账号重新签名。
它不是 App Store / TestFlight 安装包，也不能直接点开安装。

[下载侧载测试版](https://github.com/mx3353672833-debug/moto-gps-waveshare/releases/tag/v0.3.1-sideload)

下载 `MOTO-GPS-0.3.1-6-unsigned.ipa`，`SHA256SUMS.txt` 用于核对文件完整性。
源码和构建方式公开在本仓库；不要向作者或他人提供 Apple 账号密码、签名证书或配对文件。

## 通过 SideStore 安装

1. 按 [SideStore 官方安装教程](https://docs.sidestore.io/docs/installation/install)在你的设备上安装 SideStore。
   首次准备需要电脑；Windows 用户也可以按其官方流程操作，不需要 Mac 编译本项目。
2. 把 IPA 下载到 iPhone 的“文件”中，在 SideStore 的 My Apps 页面选择导入 IPA，用你自己的账号签名安装。
3. 按系统提示信任开发者、开启开发者模式，并授予 MOTO GPS 蓝牙和定位权限。
4. 进入 MOTO GPS 的“网关设置”，填写自己的 HTTPS 网关地址并保存。
5. 用真实搜索、圆屏连接、锁屏后的定位更新和断线重连确认实际设备上的表现。

SideStore 使用免费 Apple 账号时有应用数量和约 7 天签名有效期限制，需要刷新签名；
具体安装条件与刷新方式以 [SideStore 官方说明](https://docs.sidestore.io/docs/faq)为准。
侧载安装流程可行，不等于已经在所有 iOS / SideStore 版本上完成蓝牙和后台导航验收。

## 设置自己的网关

第一次启动会显示“设置导航网关”，也可以点出发页左上角齿轮进入“网关设置”。

- 自建服务器示例：`https://nav.example.com/moto-gps/api/`
- Workers 示例：`https://moto-gps-gateway.YOUR-SUBDOMAIN.workers.dev/`

把示例替换成自己的真实地址。填写的是网关根地址，**不要带 `/healthz`、`/v1/routes` 等接口路径**，
也不要填写高德 Key、账号密码或查询参数。只有 HTTPS 地址可以保存，结尾 `/` 会自动补齐。
网关根路径中的 `/moto-gps/api/` 等前缀会保留。

“测试连接”检查 `/healthz`，区分已启用实时导航和仅可连接的演示/禁用配置。
它不会替代真实搜索和路线验收，也不会自动修改服务端设置。
“保存”后立即使用新地址，不必重新编译或重新安装；关闭 App 再打开后仍保留。
导航过程中不能更换网关。更换地址会取消旧搜索/路线请求、暂停地图下载，已下载的地图仍保留。
地址只保存在当前 App 数据中，删除 App 后需重新配置。

网关是地点、路线和定位请求的接收方，请使用自己或信任方部署的服务。
部署方式任选其一：

- [Node.js + 自建服务器](GATEWAY_SETUP.md)
- [Cloudflare Workers + R2](../backend/cloudflare/README.md)

公开 IPA 默认不配置作者的私人服务，也不包含高德 Key。仅安装 IPA 并不会获得公共导航服务。
默认演示仍可使用内置测试数据，但不能当作实际路线。

## LiveContainer 的情况

LiveContainer 可以导入 IPA，但它让 App 在容器中运行，权限和运行环境与独立安装不同。
本项目依赖蓝牙、持续定位和锁屏后台运行；**尚未验证 LiveContainer 下这几项功能**。
因此当前先按 SideStore 独立安装的路径试用，不宣称 LiveContainer 已兼容。
参考 [LiveContainer 官方限制](https://github.com/LiveContainer/LiveContainer#limitations)。

## 自己构建 IPA

有完整 Xcode 和 XcodeGen 的 Mac 上，从仓库根目录运行：

```sh
scripts/ios/build_sideload_ipa.sh
```

输出在 `build/sideload/`。脚本生成 Release 的 iPhone arm64 程序，并关闭开发者签名；
不需要作者的 Team、证书或 provisioning profile。脚本校验 IPA 包结构、未加密可执行文件、
定位/蓝牙权限、开源声明和默认占位网关，并生成 SHA-256 校验文件。
需要重新签名之后才能在普通 iPhone 上运行。

仓库的 **iOS sideload build** GitHub Actions 也执行 App 单元测试、离线网关界面测试和同一打包脚本。
成功运行后，在 Artifacts 中下载 `MOTO-GPS-unsigned-IPA`（需 GitHub 登录），解压后得到 IPA 和校验文件。
公开 Release 则可直接下载。

构建和模拟器测试只能确认程序能够编译、设置与请求切换逻辑正常，不替代 SideStore / LiveContainer
真机安装、BLE、锁屏定位和真实道路测试。测试版不提供这些尚未完成的兼容性保证。
