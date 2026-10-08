# web

market-data 的本地管理页面。

当前页面：

- 市场总览
- 股票查询
- 板块对比
- 数据同步

开发环境通过 Vite 代理访问 `http://127.0.0.1:8080`。

Docker 环境由 Nginx 反向代理到 `market-data:8080`，浏览器只访问同一个 Web 地址。
