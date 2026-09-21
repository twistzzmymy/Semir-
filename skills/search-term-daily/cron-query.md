# 定时任务「搜索词每日更新」契约（cron-query 原文）

> 定时任务：每天 10:20（Asia/Shanghai，本机环境）触发，首次执行后按日自动运行。
> 下方为 `create_cron_job` 时写入的 query 原文，作为每日自动执行的完整需求契约。

---

本次请求是由「搜索词每日更新」定时任务到时触发的。任务：从生意参谋下载昨日（T-1）的引流搜索词数据并留档，再按原结构拼入搜索词主表，产出更新版主表并交付。

【数据源】用本地 sycm-cli 直连生意参谋（工具目录 E:\巴拉巴拉\AI\sycm-cli，运行方式：py -3.13，需设置 PYTHONPATH=E:\巴拉巴拉\AI\sycm-cli\.python-packages、CURL_CA_BUNDLE=%USERPROFILE%\.sycm-cli\cacert.pem、SSL_CERT_FILE 同上）。登录态来自已登录的专用 Chrome：先确认 %LOCALAPPDATA%\sycm-cli\cdp-port 指向当前 Chrome（profile 目录 C:\Users\smadmin\AppData\Local\sycm-cli\chrome-profile），用 sycm_cli.py 的 load_taobao_cookies 读 cookie。**若接口返回 code=5810 或登录页 HTML，说明登录态失效，先运行 auto_login.py（E:\巴拉巴拉\AI\Semir-\skills\search-term-daily\scripts\auto_login.py）通过 CDP 自动填入账号密码恢复登录**（凭据从 scripts/config.local.json 读取）：
  - 退出码 0：登录成功或已登录，重跑 pipeline_fetch.py
  - 退出码 2：需人工拖滑块，提示用户在专用 Chrome 手动拖一下滑块后重跑
  - 退出码 3：账号密码错误，向用户说明并请其更新 config.local.json
  - 退出码 4：Chrome 未运行，先等 sycm-cli 自动拉起 Chrome 再跑 auto_login.py
  恢复后仍失败才停止，不要反复空跑。

【接口与参数】GET /flow/v4/shop/wordAide/drainageSearch.json（选词助手-引流搜索词-店外-无线），参数：dateRange={T-1}|{T-1}、dateType=day、pageSize=100、page=1..N 分页拉全（每页约返回10条，循环直到累计行数>=recordCount）、order=desc、orderBy=uv、device=2（无线端）、kwType=se_keyword、indexCode=uv,goodsCartByrCnt,goodsCltByrCnt,payOrderUserCnt,payConvertRate,payAmt,perByrAmt,uvValue。若 recordCount=0，说明 T-1 数据尚未出（生意参谋 T+1），跳过该日并如实汇报。

【留档】生成 xls 到 E:\巴拉巴拉\搜索词数据留存\，命名【生意参谋】选词助手-引流搜索词-店外-无线-YYYYMMDD.xls（Y=T-1）。格式复刻已有留档：sheet 名【生意参谋平台】1；第1行"数据说明：以下数据为您所选时间周期的相关指标，如需查看其他时间周期的数据，请重新选择后下载"，第2行"收藏网址：d.alibaba.com，让数据帮您生意参谋！点此进入>>"，第3-5行空，第6行表头（统计日期/搜索词/访客数/加购人数/商品收藏人数/支付买家数/支付转化率/支付金额/客单价/UV价值），第7行起数据，全部文本单元格：整数加千分位（0 显示为 0）、百分比两位（如 6.85%，0 显示 0.00%，无数据显示 -）、金额两位千分位（无数据显示 0.00）、客单价/UV价值两位小数（无数据显示 -）。可用 xlwt 生成（已安装到 sycm-cli 依赖目录）。

【主表拼接】在 E:\巴拉巴拉\搜索词数据留存\ 下找最新的「搜索词留存-更新至*.xlsx」作为基准。先检查其统计日期列（C 列）是否已含 T-1：已含则跳过拼接（幂等）。未含则复制基准为新文件「搜索词留存-更新至{T-1月.日}.xlsx」，用 ZIP 级 XML 追加行（禁止 openpyxl 重存整表，会丢失原表 80222 行起年份/月份公式的缓存值；已用此方法成功生成过 9.19 版）：新增行 A/B 列写公式 =YEAR(C{r})&"年" / =MONTH(C{r})&"月" 并带缓存值（单元格 XML 形如 <c r="A{r}" s="4" t="str"><f>YEAR(C{r})&amp;&quot;年&quot;</f><v>2026年</v></c>），C 列样式 s="19"、D-L 列样式 s="20"，C-L 全部用 inlineStr 文本（值与留档一致），每行 spans="1:12"，更新 sheet1.xml 的 dimension ref 到新末行，其余 zip 条目逐字节保留。年份/月份缓存值按 T-1 实际年月填。

【校验】①新增行数 = T-1 的 recordCount；②留档 xls 与接口数据行数、首行、末行一致；③新主表新增块与留档逐行一致；④原表区域（新增行之前）与基准文件逐字符一致（可对 zip 内 sheet1.xml 做前缀/后缀比对）；⑤新主表可用 openpyxl 正常读取。

【交付】用 present_files 交付：新主表 xlsx（仅一份）+ 当日留档 xls。向用户汇报：T-1 日期、当天搜索词行数、留档文件路径、新主表路径；若 T-1 数据未出（recordCount=0），说明原因并提示次日自动补。
