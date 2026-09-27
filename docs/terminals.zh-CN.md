---
title: 终端
---

# 终端

Cypheria 终端是由 Server 管理的特权临时资源。Server 拥有 PTY 进程和权威 headless 终端状态；客户端通过 `@cypheria/client` 渲染已授权的 stream。终端实体不持久化，也不会跨 Server 重启存活。

## Thread 终端

一个 Thread 可以拥有多个终端，每个终端只属于一个 Thread。创建请求接受 Thread ID、显示名称和初始尺寸。Server 解析 Thread 当前工作目录，并拒绝不存在、已删除或已归档的 Thread。Thread 后续修改工作目录不会迁移已有 PTY；新终端使用新目录。

终端目录是共享 Server 状态。订阅同一 Thread 的客户端会收到相同的终端列表、名称、动态标题、尺寸、退出事件和进程输出。创建终端会让每个已订阅 Desktop 添加对应 tab，但 tab 顺序、选中 tab、面板位置和面板显隐仍是设备本地状态。关闭 tab 会为所有客户端终止共享 PTY。隐藏面板、离开页面、断开连接或退订不会终止它。

停止、恢复或 rewind Thread 会保留其终端。Fork Thread 不复制终端。归档或删除 Thread 会终止其全部终端。Thread 移动后，已有终端保留其原工作目录。

## 认证终端

Claude 与 ACP 的交互式认证命令使用同一个 worker、PTY、headless 状态、二进制 stream、resize 所有权和恢复实现。认证终端拥有包含 flow ID 与所属逻辑客户端 session 的私有作用域。它不会出现在 Thread 终端列表或目录通知中；即使使用同一 principal，另一个 client ID 也无法发现或订阅它。

所属逻辑客户端可以在正常 session 宽限期内重连并恢复当前终端画面。认证完成、失败、取消、逻辑 session 过期或 Server 关闭时都会终止 PTY 并释放认证 reservation。公开 rename、capture 和普通 close 操作不接受认证终端；取消仍属于 harness 操作。

## 流传输与恢复

目录和 stream 授权使用普通 CBOR 请求。终端输入、输出、resize 与 ANSI restore 使用[客户端／服务端协议](protocol.zh-CN.md)中记录的二进制 codec。每个物理连接独立分配 stream slot，因此重连会创建新的订阅和 slot。SDK 会重新订阅并请求新快照，但绝不缓存或重放用户输入。

worker 运行 `node-pty` 与 `@xterm/headless`，保留 1000 行 scrollback，合并短时输出 burst，并返回 ANSI 快照。revision barrier 会在生成快照期间暂存实时输出，之后只发送较新的输出。物理连接同时越过输出量与传输背压阈值时，会切换到新快照。resize 使用 claim 标志；最近发出 claim 的已订阅 source 拥有后续被动 resize，直到它断开或另一 source 获取所有权。

## 资源限制

Server 每个 Thread 最多允许 32 个终端，总计最多 256 个终端。每个物理连接拥有 256 个 stream slot。终端尺寸限制为 2–1000 列与 1–1000 行。输出与 restore 数据会拆分为不超过 64 KiB 的 frame。终端环境包含 `TERM=xterm-256color`、`COLORTERM=truecolor` 与 `TERM_PROGRAM=cypheria`。
