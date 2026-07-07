# Release Build

桌面版面向普通用户：用户双击应用即可使用，不需要执行 `npm start`，也不需要手动打开 `http://localhost:5177`。

## 开发预览

```powershell
npm install
npm run desktop
```

## 打包 Windows 发行版

```powershell
npm install
npm run dist
```

输出目录：

```text
release/
```

会生成安装包和便携版。安装包会创建桌面快捷方式；便携版可以直接双击运行。

## 数据保存位置

桌面版会把 SQLite 数据库放在系统用户数据目录，而不是安装目录。这样用户升级应用时，聊天记录、角色配置和记忆库不会被覆盖。

## 授权服务

普通用户只在界面里登录、绑定授权码。底层模型地址、密钥和接口信息不在普通用户界面展示。
