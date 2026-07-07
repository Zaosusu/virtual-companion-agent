# Release Build

桌面版面向普通用户。用户双击应用即可使用，无需运行 `npm start` 或手动打开 `http://localhost:5177`。

## 开发预览

```powershell
npm install
npm run desktop
```

## Windows 打包

```powershell
npm install
npm run dist
```

输出目录：

```text
release/
```

打包产物包含安装包和便携版。安装包创建桌面快捷方式；便携版可以直接双击运行。

## 数据位置

桌面版将 SQLite 数据库放在系统用户数据目录，而不是安装目录。应用升级时，聊天记录、角色配置和记忆库保留在用户数据目录中。

## 模型配置

桌面版可以使用自部署模型，也可以连接部署方提供的远程模型接口。模型地址、模型 API Key、访问令牌和用户数据都属于运行环境资产，不应提交到公开仓库。

自部署模式：

```env
COMPANION_SELF_HOSTED=1
```

开启后，用户在本地 `.env` 中配置自己的模型服务和 API Key。模型费用由用户自行承担。
