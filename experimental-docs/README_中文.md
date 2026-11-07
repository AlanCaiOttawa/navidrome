# Navidrome Collections / Resume / Recently Played / M3U Writeback — Alpha 源码

**状态：开发性源码，未生成二进制文件或 Docker 镜像，未完成真实服务器端到端测试。**

这是在用户上传的 `navidrome-master.zip` 基础上直接修改的 Navidrome Fork，不是一个另外开发的播放器。请只用于隔离测试。

## 实现位置

- `server/experimental.go`：Go API、每用户 JSON 存储、M3U 导出写回、哈希冲突检测和 M3U 备份。
- `server/server.go`：注册受认证保护的实验 API。
- `ui/src/experimental/Collections.jsx`：Collections 与最近播放列表。
- `ui/src/experimental/api.js`：状态 API、续播选择及上下文。
- `ui/src/routes.jsx`、`ui/src/layout/Menu.jsx`：新增菜单入口。
- `ui/src/album/AlbumActions.jsx`、`ui/src/playlist/PlaylistActions.jsx`：点击 **Play** 后选择续播或从头播放；Playlist 另有 `Save to M3U`。
- `ui/src/audioplayer/Player.jsx`：播放中每约 10 秒、暂停和曲目结束时写入播放位置；续播时尝试定位到上次秒数。

## 四项功能与未完成的细节

1. **Album Collections**：新建、重命名、删除 Collection；将 Album 添加/移除；同一 Album 可以属于多个 Collection；每用户独立保存。当前仅提供文字列表和专用选择框，尚未实现 Album 封面网格、批量添加与按文件夹批量归类。
2. **Resume Playback**：专用于 Navidrome 自带 Web UI 的 **Play** 按钮，保存 Album/Playlist 的播放上下文、曲目 ID 和播放秒数，跨浏览器读取服务器数据。直接点击单曲、随机播放或其他外部播放器暂不保证能正确记录上下文。原始队列改变或曲目被移除时，应从头播放。
3. **Recently Played**：在 `Collections / Recently Played` 页面显示最近 30 个 Album / Playlist。当前是文字列表而非封面网格，列表可能需要手动重新进入页面刷新。
4. **M3U Writeback**：对已导入且**已经关闭 Auto-import/Sync** 的普通 Playlist，可手动点击 `Save to M3U` 将当前曲目顺序写回 NAS 的源 M3U。必须配置源路径与写路径的对应关系；保存前对照 SHA-256，若文件变化则拒绝覆盖；成功前先备份一份原 M3U。**不是无冲突的双向实时同步**。保存完毕后可重新启用 Sync。Audio Station 的内部 Playlist 数据是否即时刷新，需要在 NAS 上实测。

## Synology DS720+ 测试

1. **先备份** `/volume1/cloud/music archive/playlist` 中全部 M3U 文件，同时保留现有正式 Navidrome 容器。
2. 将源码解压到可以运行 Docker build 的环境；最好在性能较好的 PC 上构建，NAS 上构建会非常慢。此源码要求 Go 1.27、Node 以及构建时的网络依赖；仓库中已有多阶段 Dockerfile。
3. 根据你的 NAS 实际路径修改 `experimental-docs/docker-compose.synology.yml` 中的 Music 文件夹及 Playlist 文件夹映射。
4. 在源码根目录运行：

   ```sh
   docker compose --env-file experimental-docs/.env -f experimental-docs/docker-compose.synology.yml up -d --build
   ```

5. 用浏览器打开 `http://NAS-IP:4534`，创建**独立测试管理员**（使用独立 `/data` 数据库），让音乐库扫描完成。打开左侧 `Collections / Recently Played`。
6. 打开 Album 或 Playlist，使用 **Play** 按钮开始播放、暂停，重新打开测试是否出现 Resume 选择。
7. 对 `Save to M3U` 测试：选择导入的 Playlist，先通过 Playlist Edit 关闭 `Sync`，修改歌曲顺序，点击 `Save to M3U`。若 API 返回冲突则不要覆盖，检查 Audio Station 对源文件做了什么修改。

**重要：**如果 Synology 中已有一个在使用端口 `4533` 的 Navidrome，测试版改用 `4534`；测试版的 `/data` 必须独立。请不要让不同版本同时写入同一个 Navidrome 数据库。

## 编译/测试现状

当前生成环境没有 Docker，且无法联网下载 Go 1.27 的工具链和 NPM 依赖。因此没有成功执行 `docker build`、Go 单元测试、前端构建和 NAS 集成测试。已经使用 `gofmt` 对 Go 代码进行语法格式处理，使用本地 TypeScript 解析器检查所有修改过的 JS/JSX 文件语法。**这些检查不能保证运行时正确。**

## 风险与后续需要验证

- UI 内的 Resume 目前是浏览器 `confirm` 对话框，尚未替换为原生 Material UI Dialog。
- 多个浏览器对同一个用户同时写入进度，当前采用最后写入优先；跨设备可以读取，但并发播放可能覆盖位置。
- Collections 修改是全量写入；多个设备同时编辑 Collection 会有覆盖风险。
- 若 M3U 内歌曲被外部修改，且 Navidrome Sync 被关闭，需由用户手工决定何时重新同步。
- M3U 写回操作一次只处理一个已导入 Playlist；必须保证实际 M3U 源文件位于配置的 source root 下。对于 M3U8、嵌套不同音乐库路径、符号链接、非常规权限等，需要进一步测试。
- 执行 M3U 修改会改变真实 Playlist 文件：请在隔离副本中先试验，并审查生成的内容及备份文件。

## Alpha 0.2：用户指定 Synology Playlist 文件夹

先在 `experimental-docs` 下创建 `.env`（复制 `.env.example`），填写 NAS 上实际存在的音乐目录和 **Playlist 目录的 Synology 绝对路径**：

```dotenv
SYNOLOGY_MUSIC_FOLDER=/volume1/cloud/music archive
SYNOLOGY_PLAYLIST_FOLDER=/volume1/cloud/music archive/playlist
```

Docker 不允许网页程序直接读取未经映射的 NAS 路径。上面的映射必须由管理员在部署时进行。**Playlist 目录应位于音乐库根目录内部**，使 M3U 中 `../` 相对路径可以找到音乐文件。

启动后，以 Navidrome 管理员进入 **Collections / Recently Played > Synology M3U Playlist Folder**，输入相对于 `/music` 的文件夹，例如 `playlist`，点击 **Save folder**；然后重启测试容器并触发一次音乐库扫描。设置存在独立的 `/data/experimental/playlist-folder.json` 中，重启后依旧存在。

写回注意：`/m3u-write` 必须映射到 **当前选定的同一个 NAS Playlist 文件夹**，否则写回功能会拒绝操作或找不到原文件。切换到不同的 NAS 目录，需要先修改 `.env` 中的宿主路径并重建容器。仅在网页里修改相对路径不能更改 Docker 的宿主目录授权。若文件夹不在音乐根目录下，需要先安排音乐目录及 Playlist 的挂载结构，不能直接选择任意 NAS 绝对路径。

**同步方向：** 选定文件夹中的 M3U 经常规扫描导入/更新；在 Navidrome 中修改内容后仍需先关闭该 Playlist 的 Sync，再点击 Save to M3U 写回。尚不支持双方同时编辑的自动冲突合并，也不保证 Audio Station 会实时刷新其内部播放列表。

**启动命令（确保 `.env` 生效）：**

```sh
docker compose --env-file experimental-docs/.env -f experimental-docs/docker-compose.synology.yml up -d --build
```
