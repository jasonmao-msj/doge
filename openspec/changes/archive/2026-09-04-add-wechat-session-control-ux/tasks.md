# 微信会话生命周期与控制命令易用性 Tasks

- [x] 1.1 为 WeChat route 增加 optional `lastActivityAtMs` 与集中 expiry policy。
- [x] 1.2 实现 ledger 的 `reset_session`、time-aware lookup 和成功 turn timestamp 更新。
- [x] 1.3 增加 `/new`、`/help` aliases 与可发现的回复文案。
- [x] 1.4 添加 legacy persistence、expiry、manual reset、target isolation 和 parser regression tests。
- [x] 1.5 运行 focused Rust verification、format check 和 runtime contract checks，并记录未覆盖范围。
