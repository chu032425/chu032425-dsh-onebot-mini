# 推送到 GitHub

代码已在本地提交（`git log` 可见）。推送需要你自己的凭据，以下任选其一。

## 方式 1：在这台机器的终端里（推荐）

```sh
cd /workspace/默认/dsh-onebot-mini
git remote add origin https://<你的用户名>@github.com/<你的用户名>/dsh-onebot-mini.git
git push -u origin main
```

首次推送会提示输入密码 —— **粘贴你的 Personal Access Token**（不是账号密码）。
token 只需 `repo` 权限。

## 方式 2：用 token 直接推（不交互）

```sh
cd /workspace/默认/dsh-onebot-mini
git remote add origin https://<token>@github.com/<你的用户名>/dsh-onebot-mini.git
git push -u origin main
# 推完后立刻把 remote 改回不带 token 的形式，避免 token 留在 .git/config
git remote set-url origin https://github.com/<你的用户名>/dsh-onebot-mini.git
```

## 方式 3：先在 GitHub 建好空仓库

在 github.com 新建仓库 `dsh-onebot-mini`（**不要**勾选 README/gitignore/LICENSE，
保持空仓库），然后：

```sh
cd /workspace/默认/dsh-onebot-mini
git remote add origin https://github.com/<你的用户名>/dsh-onebot-mini.git
git branch -M main
git push -u origin main
```

## 装到别的设备

推送成功后，任意一台装了 dsh 的机器：

```sh
dsh plugin --profile web add https://github.com/<你的用户名>/dsh-onebot-mini
```

或先在 Plugins 页点 **Add plugin** 填仓库地址。装完重启 `dsh web`。

## 不想走 GitHub

工作区里已经有打好的包 `dsh-onebot-mini-0.1.0.tgz`，从 Web 界面文件侧栏下载后：

```sh
dsh plugin --profile web add ./dsh-onebot-mini-0.1.0.tgz
```
