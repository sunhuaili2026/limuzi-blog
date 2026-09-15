(function () {
const API_PASSWORD = "limuzi2025";
    const STORAGE_KEY = "smartcs_coldstart_tasks_v1";
    const BATCH_CHARS = 28000;
    const MAX_STORE_CHARS = 8000;
    const MAX_INPUT_CHARS = 2000000;
    const API_TIMEOUT_MS = 18000;
    const BINARY_HINT = /PK\x03\x04|docProps\/|xl\/|\[Content_Types\]\.xml|\x00/;

    /** @type {Array<any>} */
    let tasks = loadTasks();
    let activeTaskId = tasks[0] ? tasks[0].id : null;
    let running = false;
    /** @type {Map<string, string>} */
    const inputStore = new Map();
    tasks.forEach((task) => {
        if (task && task.id && typeof task.input === "string" && task.inputChars && task.input.length < task.inputChars) {
            /* full text not restored from localStorage preview */
        }
    });

    const SAMPLE = `客户：我的车充不进电，充电器灯是红的
客服：您好，请问是哪款车型？电池是否在车上充电？
客户：E200P，电池插在车上充
客服：请先确认充电器指示灯是否正常。红灯常亮通常表示未正确连接，请检查充电口是否卡到位。
客户：我拔插了好几次还是红灯
客服：建议您换一个插座试一下，并确认充电器型号与车辆匹配。如果仍无法充电，可以申请售后检测。
客户：那大概多久能修好？
客服：检测一般 1-3 个工作日，如确认充电器故障可走质保更换。

——会话——

客户：APP 里显示车辆离线，怎么配网？
客服：请打开手机蓝牙和定位，进入 APP「添加车辆」，按仪表提示进入配网模式。
客户：我点了配网，但一直转圈
客服：请确认手机与车辆距离在 2 米内，并关闭其他 VPN。若超过 2 分钟仍失败，可重启车辆仪表后再试。
客户：重启后成功了，谢谢
客服：配网成功后建议做一次固件检查，有 OTA 更新可一并完成。

——会话——

客户：订单下了三天还没发货，单号 2026030888
客服：我帮您查询……仓库显示缺货中的配件已到仓，今晚会发出。
客户：能改成顺丰吗？
客服：可以，我帮您备注加急物流，运费差价会以短信通知。
客户：好的
客服：已提交加急，预计明天揽收。`;

    const $ = (id) => document.getElementById(id);
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    const page = document.body && document.body.dataset ? (document.body.dataset.page || "") : "";
    function goTask(id) { location.href = "task.html?id=" + encodeURIComponent(id); }
    function qs(name) {
        const u = new URL(location.href);
        return u.searchParams.get(name);
    }

    function toast(msg) {
        const el = $("toast");
        if (!el) return;
        el.textContent = msg;
        el.classList.add("show");
        clearTimeout(toast._t);
        toast._t = setTimeout(() => el.classList.remove("show"), 3200);
    }
    function banner(msg, type) {
        const el = $("globalBanner");
        if (!el) return;
        el.textContent = msg;
        el.className = "sc-banner show" + (type ? " " + type : "");
    }
    function esc(s) {
        const d = document.createElement("div");
        d.textContent = s == null ? "" : String(s);
        return d.innerHTML;
    }
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    function uid() { return "task_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7); }
    function nowISO() { return new Date().toISOString(); }
    function fmtTime(iso) {
        if (!iso) return "-";
        const d = new Date(iso);
        const p = (n) => String(n).padStart(2, "0");
        return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    }

    function loadTasks() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (_) { return []; }
    }
    function saveTasks() {
        try {
            const slim = tasks.slice(0, 30).map((task) => {
                const copy = Object.assign({}, task);
                if (typeof copy.input === "string" && copy.input.length > MAX_STORE_CHARS) {
                    if (copy.id) inputStore.set(copy.id, copy.input);
                    copy.inputChars = copy.input.length;
                    copy.inputPreview = copy.input.slice(0, MAX_STORE_CHARS);
                    copy.input = copy.inputPreview;
                }
                return copy;
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
        } catch (_) {}
    }
    function getTaskInput(task) {
        if (!task) return "";
        if (task.id && inputStore.has(task.id)) return inputStore.get(task.id);
        return task.input || "";
    }
    function getTask(id) { return tasks.find((t) => t.id === id) || null; }
    function setActive(id) {
        activeTaskId = id;
        renderTaskList();
        renderDetail();
    }

    function looksBinary(text) {
        if (!text) return false;
        if (BINARY_HINT.test(text.slice(0, 2000))) return true;
        let bad = 0;
        const sample = text.slice(0, 4000);
        for (let i = 0; i < sample.length; i++) {
            const c = sample.charCodeAt(i);
            if (c === 0 || (c < 9) || (c > 14 && c < 32)) bad++;
        }
        return bad / Math.max(sample.length, 1) > 0.08;
    }

    function parseDialogues(raw) {
        const text = (raw || "").trim();
        if (!text) return { sessions: [], turns: 0, chars: 0, quality: "不足", tips: ["请粘贴至少一段完整对话"] };
        const chunks = text
            .split(/\n\s*(?:-{2,}|—{2,}|={2,}|会话分隔|——会话——)\s*\n/i)
            .map((s) => s.trim()).filter(Boolean);
        const sessions = chunks.map((chunk, idx) => {
            const lines = chunk.split(/\n+/).map((l) => l.trim()).filter(Boolean);
            const turns = lines.filter((l) => /^(客户|用户|客服|坐席|系统|agent|user|bot)[:：]/i.test(l));
            return { id: idx + 1, raw: chunk, lines: lines.length, turns: turns.length || Math.max(1, Math.floor(lines.length / 2)) };
        });
        const turns = sessions.reduce((a, s) => a + s.turns, 0);
        const chars = text.replace(/\s+/g, "").length;
        let quality = "一般";
        const tips = [];
        if (sessions.length >= 2 && turns >= 8 && chars >= 200) quality = "良好";
        if (sessions.length >= 3 && turns >= 15 && chars >= 500) quality = "优秀";
        if (chars < 120) tips.push("文本偏短，建议补充更多会话");
        if (sessions.length < 2) tips.push("建议提供 2 段以上不同场景会话");
        if (!/(客户|用户|客服)/.test(text)) tips.push("未检测到「客户/客服」角色标注，准确率可能下降");
        return { sessions, turns, chars, quality, tips };
    }

    function refreshInputStats() {
        if (!$("chatInput")) return { sessions: [], turns: 0, chars: 0, quality: "-" };
        const meta = parseDialogues($("chatInput").value);
        $("statSessions").textContent = meta.sessions.length;
        $("statTurns").textContent = meta.turns;
        $("statChars").textContent = meta.chars;
        $("statQuality").textContent = meta.quality;
        updateInputSummary(meta);
        return meta;
    }

    function updateInputSummary(meta, extra) {
        const el = $("inputSummary");
        if (!el) return;
        if (!meta || !meta.chars) {
            el.textContent = "尚未载入内容。请上传 Excel/CSV，或点击「载入示例对话」。";
            return;
        }
        const batches = Math.max(1, Math.ceil(meta.chars / BATCH_CHARS));
        let msg = "已载入 " + meta.sessions.length + " 段 / " + meta.turns + " 轮 / " + meta.chars + " 字（全文不展示，仅用于分析）";
        if (batches > 1) msg += " · 将自动分 " + batches + " 批处理";
        if (extra) msg += " · " + extra;
        el.textContent = msg;
    }

    function splitTextIntoBatches(text, maxChars) {
        const limit = maxChars || BATCH_CHARS;
        const meta = parseDialogues(text);
        const sessions = (meta.sessions && meta.sessions.length)
            ? meta.sessions
            : [{ id: 1, raw: text, lines: 0, turns: 0 }];
        const batches = [];
        let buf = [];
        let size = 0;
        const sep = "\n\n——会话——\n\n";
        sessions.forEach((s) => {
            const chunk = String(s.raw || "").trim();
            if (!chunk) return;
            const add = chunk.length + (buf.length ? sep.length : 0);
            if (buf.length && size + add > limit) {
                batches.push(buf.join(sep));
                buf = [chunk];
                size = chunk.length;
            } else {
                buf.push(chunk);
                size += add;
            }
        });
        if (buf.length) batches.push(buf.join(sep));
        if (!batches.length && String(text || "").trim()) {
            const raw = String(text).trim();
            for (let i = 0; i < raw.length; i += limit) batches.push(raw.slice(i, i + limit));
        }
        return batches;
    }

    function normKey(s) {
        return String(s || "").toLowerCase().replace(/\s+/g, "").slice(0, 80);
    }

    function mergeAnalysisResults(parts, company, brief, fullMeta, mode) {
        const scenarios = [];
        const sops = [];
        const faqs = [];
        const risks = [];
        const seenSc = new Set();
        const seenSop = new Set();
        const seenFaq = new Set();
        const seenRisk = new Set();
        (parts || []).forEach((p) => {
            if (!p) return;
            (p.scenarios || p.scenes || []).forEach((s) => {
                const k = normKey(s.name || s.title);
                if (!k || seenSc.has(k)) return;
                seenSc.add(k);
                scenarios.push(s);
            });
            (p.sops || []).forEach((s) => {
                const k = normKey(s.scenario || s.name);
                if (!k || seenSop.has(k)) return;
                seenSop.add(k);
                sops.push(s);
            });
            (p.faqs || []).forEach((f) => {
                const k = normKey(f.question || f.q);
                if (!k || seenFaq.has(k)) return;
                seenFaq.add(k);
                faqs.push(f);
            });
            (p.risks || []).forEach((r) => {
                const k = normKey(r.title || r.name);
                if (!k || seenRisk.has(k)) return;
                seenRisk.add(k);
                risks.push(r);
            });
        });
        const base = parts && parts[0] ? parts[0] : {};
        return {
            summary: company + " 冷启动任务完成（" + (mode || "batch") + "）：共处理 " +
                ((fullMeta && fullMeta.sessions) ? fullMeta.sessions.length : 0) + " 段输入，分 " +
                (parts ? parts.length : 0) + " 批聚合 → " + scenarios.length + " 场景 / " +
                sops.length + " SOP / " + faqs.length + " FAQ。",
            scenarios: scenarios.length ? scenarios : (base.scenarios || base.scenes || []),
            sops: sops.length ? sops : (base.sops || []),
            faqs: faqs.length ? faqs : (base.faqs || []),
            risks: risks.length ? risks : (base.risks || []),
            meta: {
                mode: mode || "batch",
                company: company,
                brief: brief,
                generatedAt: nowISO(),
                input: fullMeta,
                batches: parts ? parts.length : 0
            }
        };
    }


    function industryLabel(v) {
        return ({ mobility: "智能出行", ecommerce: "电商零售", saas: "SaaS", finance: "金融保险", general: "通用客服" })[v] || "通用客服";
    }

    function normalizeHeader(h) { return String(h || "").trim().toLowerCase().replace(/\s+/g, ""); }
    function pickColumn(headers, aliases) {
        const normalized = headers.map(normalizeHeader);
        for (const alias of aliases) {
            const idx = normalized.findIndex((h) => h === alias || h.includes(alias));
            if (idx >= 0) return idx;
        }
        return -1;
    }

    function sheetRowsToText(rows) {
        if (!rows || !rows.length) return "";
        const header = (rows[0] || []).map((c) => String(c == null ? "" : c).trim());
        const dataRows = rows.slice(1).filter((r) => (r || []).some((c) => String(c == null ? "" : c).trim()));
        const qIdx = pickColumn(header, ["问题", "标准问", "标准问法", "question", "q", "faq", "用户问", "客户问", "标题"]);
        const aIdx = pickColumn(header, ["答案", "回答", "answer", "a", "回复", "标准答", "客服答"]);
        const cIdx = pickColumn(header, ["客户", "用户", "customer", "user"]);
        const sIdx = pickColumn(header, ["客服", "坐席", "agent", "bot", "机器人"]);
        const sceneIdx = pickColumn(header, ["场景", "scene", "意图", "分类", "目录", "category"]);
        const blocks = [];

        if (qIdx >= 0 && aIdx >= 0) {
            dataRows.forEach((row, i) => {
                const q = String(row[qIdx] || "").trim();
                const a = String(row[aIdx] || "").trim();
                if (!q && !a) return;
                const scene = sceneIdx >= 0 ? String(row[sceneIdx] || "").trim() : "";
                let block = "";
                if (scene) block += "【场景】" + scene + "\n";
                block += "客户：" + (q || ("问题" + (i + 1))) + "\n";
                block += "客服：" + (a || "（暂无标准答）");
                blocks.push(block);
            });
            return blocks.join("\n\n——会话——\n\n");
        }
        if (cIdx >= 0 && sIdx >= 0) {
            dataRows.forEach((row) => {
                const c = String(row[cIdx] || "").trim();
                const s = String(row[sIdx] || "").trim();
                if (!c && !s) return;
                blocks.push((c ? ("客户：" + c + "\n") : "") + (s ? ("客服：" + s) : ""));
            });
            return blocks.join("\n\n——会话——\n\n");
        }
        dataRows.forEach((row, i) => {
            const parts = [];
            header.forEach((h, idx) => {
                const val = String(row[idx] == null ? "" : row[idx]).trim();
                if (val) parts.push((h || ("列" + (idx + 1))) + "：" + val);
            });
            if (!parts.length) return;
            if (parts.length === 1) blocks.push("客户：" + parts[0] + "\n客服：请结合业务背景给出标准答复。");
            else blocks.push("【条目 " + (i + 1) + "】\n" + parts.join("\n"));
        });
        return blocks.join("\n\n——会话——\n\n");
    }

    async function readUploadFile(file) {
        const name = (file.name || "").toLowerCase();
        if (/\.(xlsx|xls|csv)$/i.test(name)) {
            if (typeof XLSX === "undefined") throw new Error("Excel 解析库未加载，请刷新页面");
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: "array", codepage: 65001 });
            const sheetName = wb.SheetNames[0];
            if (!sheetName) throw new Error("表格中没有可用工作表");
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false });
            if (/\.csv$/i.test(name) && rows.length && rows.every((r) => (r || []).filter((c) => String(c).trim()).length <= 1)) {
                return { text: rows.map((r) => String((r && r[0]) || "").trim()).filter(Boolean).join("\n"), meta: "已解析 CSV 文本" };
            }
            const text = sheetRowsToText(rows);
            if (!text.trim()) throw new Error("表格内容为空，或未能识别「问题/答案」「客户/客服」列");
            return { text, meta: "已解析「" + sheetName + "」共 " + Math.max(rows.length - 1, 0) + " 行" };
        }
        const text = await file.text();
        if (looksBinary(text)) throw new Error("检测到二进制乱码。请上传 .xlsx/.csv，或纯文本对话，不要当 TXT 打开 Excel。");
        return { text, meta: "已读取文本文件" };
    }

    function extractFaqsFromText(text, limit) {
        const max = limit || 8;
        const lines = String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
        const faqs = [];
        const seen = new Set();
        for (let i = 0; i < lines.length; i++) {
            const qLine = lines[i];
            const aLine = lines[i + 1] || "";
            const qm = qLine.match(/^(?:客户|用户|user)[:：]\s*(.+)$/i);
            const am = aLine.match(/^(?:客服|坐席|agent|bot)[:：]\s*(.+)$/i);
            if (!qm) continue;
            const question = qm[1].trim();
            const answer = am ? am[1].trim() : "请结合业务背景给出标准答复。";
            const key = question.toLowerCase().replace(/\s+/g, "").slice(0, 40);
            if (!question || seen.has(key)) continue;
            seen.add(key);
            faqs.push({
                question: question.slice(0, 80),
                answer: answer.slice(0, 160),
                category: "批量抽取",
                priority: "P1",
                similar: []
            });
            if (am) i += 1;
            if (faqs.length >= max) break;
        }
        return faqs;
    }

    function buildOfflineResult(company, brief, meta) {
        return {
            summary: company + " 冷启动任务完成（离线演示）：基于 " + meta.sessions.length + " 段输入，覆盖充电、配网、物流三类高频场景。",
            scenarios: [
                { name: "充电异常排查", description: "车辆无法充电、充电器指示灯异常时的首问与排查路径。", frequency: "高", intent: "售后-充电", priority: "P0" },
                { name: "车辆配网 / 离线", description: "APP 显示离线、配网失败、蓝牙定位权限相关引导。", frequency: "高", intent: "使用指导-配网", priority: "P0" },
                { name: "物流催发 / 改派", description: "订单未发货查询、加急与物流方式变更。", frequency: "中", intent: "订单-物流", priority: "P1" }
            ],
            sops: [
                {
                    scenario: "充电异常排查",
                    goal: "快速判断接触不良、供电问题或硬件故障",
                    steps: ["确认车型与充电方式", "检查指示灯并重新插接", "更换插座并核对充电器型号", "仍失败则引导售后检测与质保说明"],
                    escalation: "连续失败或需换件时转售后工单"
                },
                {
                    scenario: "车辆配网",
                    goal: "完成 APP 绑定与联网",
                    steps: ["确认蓝牙定位开启并靠近车辆", "进入配网并检查 VPN", "超时则重启仪表重试", "成功后检查 OTA"],
                    escalation: "多次失败疑似硬件问题转技术支持"
                }
            ],
            faqs: [
                { question: "充电器红灯常亮充不进电怎么办？", answer: "请先确认充电口卡到位并更换插座；仍红灯则核对充电器型号，必要时申请售后检测，质保范围内可更换。", category: "售后/充电", priority: "P0", similar: ["充不进电红灯", "充电器一直红灯", "车上充电没反应", "电池充不上电"] },
                { question: "APP 显示车辆离线如何重新配网？", answer: "打开蓝牙和定位，在 APP 添加车辆并按仪表配网；保持两米内，关闭 VPN；失败可重启仪表后再试。", category: "使用指导/配网", priority: "P0", similar: ["车辆离线怎么配网", "配网一直转圈", "蓝牙配不上", "APP连不上车"] },
                { question: "下单多日未发货可以改加急物流吗？", answer: "可以查询仓库并备注加急；若有运费差价会短信通知，提交后一般次日揽收。", category: "订单/物流", priority: "P1", similar: ["怎么催发货", "能改顺丰吗", "订单多久发货", "想加急物流"] }
            ],
            risks: [
                { level: "中", title: "质保口径需统一", detail: "充电故障涉及质保更换时，需与售后政策对齐时效与责任边界。" },
                { level: "低", title: "离线演示偏差", detail: "当前为离线结果，上线前建议用真实对话在 API 模式重跑并人工审核。" }
            ],
            meta: { mode: "offline-demo", company, brief, generatedAt: nowISO(), input: meta }
        };
    }

    async function callAPI(messages, temperature) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
        try {
            const res = await fetch("/api/deepseek", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: ctrl.signal,
                body: JSON.stringify({
                    password: API_PASSWORD,
                    model: "deepseek-chat",
                    messages,
                    temperature: temperature == null ? 0.35 : temperature
                })
            });
            if (!res.ok) {
                const t = await res.text().catch(() => "");
                throw new Error("API " + res.status + (t ? ": " + t.slice(0, 80) : ""));
            }
            const data = await res.json();
            const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (!content) throw new Error("API 返回为空");
            return content;
        } finally {
            clearTimeout(timer);
        }
    }

    function parseJSON(text) {
        const m = String(text).match(/\{[\s\S]*\}/);
        if (!m) throw new Error("无法解析模型 JSON");
        return JSON.parse(m[0]);
    }

    async function analyzeWithAPI(task, text, meta) {
        const industry = industryLabel(task.config.industry);
        const withSimilar = !!task.config.genSimilar;
        const system = "你是 AI 客服冷启动架构师，服务企业「" + task.config.company + "」（行业：" + industry + "；背景：" + (task.config.brief || "未提供") + "）。\n" +
            "任务：从客服对话中产出可直接用于机器人冷启动的结构化资产。\n" +
            "分析重心：" + task.config.focus + "。\n只返回合法 JSON，不要 Markdown。字段：\n" +
            "{\n  \"summary\": \"一句话总览\",\n  \"scenarios\": [{\"name\":\"\",\"description\":\"\",\"frequency\":\"高/中/低\",\"intent\":\"意图路径\",\"priority\":\"P0/P1/P2\"}],\n" +
            "  \"sops\": [{\"scenario\":\"\",\"goal\":\"\",\"steps\":[\"...\"],\"escalation\":\"\"}],\n" +
            "  \"faqs\": [{\"question\":\"\",\"answer\":\"\",\"category\":\"目录\",\"priority\":\"P0/P1/P2\"" + (withSimilar ? ",\"similar\":[\"口语相似问\"]" : "") + "}],\n" +
            "  \"risks\": [{\"level\":\"高/中/低\",\"title\":\"\",\"detail\":\"\"}]\n}\n" +
            "要求：场景按业务价值排序；SOP 可执行；FAQ 口语清晰；不要编造不存在的政策数字。";

        await updateTaskProgress(task.id, "scene", 35, "正在挖掘业务场景与意图…");
        const content = await callAPI([
            { role: "system", content: system },
            { role: "user", content: "以下是已解析输入（约 " + meta.sessions.length + " 段 / " + meta.turns + " 轮）：\n\n" + text.slice(0, 28000) }
        ], 0.35);

        await updateTaskProgress(task.id, "sop", 70, "正在整理 SOP、FAQ 与风险点…");
        const data = parseJSON(content);
        data.meta = {
            mode: "api",
            company: task.config.company,
            brief: task.config.brief,
            industry,
            focus: task.config.focus,
            generatedAt: nowISO(),
            input: meta
        };

        if (withSimilar) {
            const need = (data.faqs || []).filter((f) => !Array.isArray(f.similar) || f.similar.length < 3);
            if (need.length) {
                await updateTaskProgress(task.id, "faq", 82, "正在补齐口语相似问…");
                try {
                    const simRaw = await callAPI([
                        { role: "system", content: "你为客服 FAQ 生成口语相似问。只返回 JSON：{\"items\":[{\"question\":\"原问\",\"similar\":[\"...\"]}]}" },
                        { role: "user", content: JSON.stringify(need.map((f) => ({ question: f.question, answer: f.answer }))) }
                    ], 0.5);
                    const sim = parseJSON(simRaw);
                    const map = new Map((sim.items || []).map((i) => [i.question, i.similar || []]));
                    data.faqs = (data.faqs || []).map((f) => ({
                        ...f,
                        similar: (f.similar && f.similar.length ? f.similar : map.get(f.question)) || []
                    }));
                } catch (_) {}
            }
        }
        await updateTaskProgress(task.id, "faq", 90, "FAQ 整理完成");
        return data;
    }

    function statusLabel(s) {
        return ({ queued: "排队中", running: "运行中", done: "已完成", failed: "失败" })[s] || s;
    }

    function renderTaskList() {
        const table = $("taskTable");
        const list = $("taskList");
        const empty = $("taskListEmpty");
        const doneCount = tasks.filter((t) => t.status === "done").length;
        const runCount = tasks.filter((t) => t.status === "running" || t.status === "queued").length;
        if ($("dashTotal")) $("dashTotal").textContent = String(tasks.length);
        if ($("dashDone")) $("dashDone").textContent = String(doneCount);
        if ($("dashRunning")) $("dashRunning").textContent = String(runCount);
        const faqSum = tasks.reduce((a, t) => a + ((t.result && t.result.faqs && t.result.faqs.length) || 0), 0);
        if ($("dashFaqs")) $("dashFaqs").textContent = String(faqSum);

        if (!tasks.length) {
            if (table) table.innerHTML = "";
            if (list) list.innerHTML = "";
            if (empty) empty.style.display = "block";
            return;
        }
        if (empty) empty.style.display = "none";

        const html = tasks.map((t) => {
            const pct = (t.progress && t.progress.pct != null) ? t.progress.pct : 0;
            const company = (t.config && t.config.company) || "-";
            if (table) {
                return '<a class="task-row" href="task.html?id=' + encodeURIComponent(t.id) + '">' +
                    '<div><div class="title">' + esc(t.name) + '</div><div class="sub">' + esc(t.id) + '</div></div>' +
                    '<div class="cell">' + esc(company) + '</div>' +
                    '<div class="cell"><span class="task-status ' + esc(t.status) + '">' + esc(statusLabel(t.status)) + '</span></div>' +
                    '<div class="cell">' + esc(fmtTime(t.createdAt)) + (pct ? (' · ' + pct + '%') : '') + '</div>' +
                    '<div class="cell">查看 →</div></a>';
            }
            const active = t.id === activeTaskId ? " active" : "";
            return '<div class="task-card' + active + '" data-id="' + esc(t.id) + '">' +
                '<div class="title">' + esc(t.name) + '</div>' +
                '<div class="meta">' +
                '<span class="task-status ' + esc(t.status) + '">' + esc(statusLabel(t.status)) + '</span>' +
                '<span>' + esc(company) + '</span>' +
                '<span>' + esc(fmtTime(t.createdAt)) + '</span>' +
                (pct ? '<span>' + pct + '%</span>' : '') +
                '</div></div>';
        }).join("");

        if (table) table.innerHTML = html;
        if (list) list.innerHTML = html;
    }

    function resetPipeline() {
        document.querySelectorAll("#pipeline .sc-step").forEach((el) => el.classList.remove("active", "done"));
    }
    function paintPipeline(step, state) {
        const order = ["parse", "scene", "sop", "faq", "review"];
        const idx = order.indexOf(step);
        const mode = state === "done" ? "done" : (state === "active" || !state ? "active" : state);
        document.querySelectorAll("#pipeline .sc-step").forEach((el) => { // multipage-safe
            const i = order.indexOf(el.dataset.step);
            el.classList.remove("active", "done");
            if (state === "done") {
                if (i <= idx) el.classList.add("done");
                return;
            }
            if (i < idx) el.classList.add("done");
            else if (i === idx) el.classList.add(mode);
        });
    }

    function renderDetail() {
        const task = getTask(activeTaskId);
        if (!task) {
            $("detailEmpty").style.display = "block";
            $("detailBody").style.display = "none";
            return;
        }
        $("detailEmpty").style.display = "none";
        $("detailBody").style.display = "block";
        $("detailId").textContent = task.id + " · 创建于 " + fmtTime(task.createdAt);
        $("detailTitle").textContent = task.name;
        $("detailStatus").className = "task-status " + task.status;
        $("detailStatus").textContent = statusLabel(task.status);
        $("detailError").textContent = task.error || "";

        const pct = (task.progress && task.progress.pct) || 0;
        const msg = (task.progress && task.progress.message) || "等待开始";
        const step = (task.progress && task.progress.step) || "parse";
        $("progressFill").style.width = pct + "%";
        $("progressText").textContent = msg;
        $("progressPct").textContent = pct + "%";
        resetPipeline();
        if (task.status === "done") paintPipeline("review", "done");
        else if (task.status === "failed") paintPipeline(step, "active");
        else paintPipeline(step, task.status === "running" ? "active" : null);

        if (task.status === "done" && task.result) {
            $("resultWrap").style.display = "block";
            renderResult(task.result);
        } else {
            $("resultWrap").style.display = "none";
        }
    }

    async function updateTaskProgress(id, step, pct, message) {
        const task = getTask(id);
        if (!task) return;
        task.status = "running";
        task.progress = { step, pct, message };
        task.updatedAt = nowISO();
        saveTasks();
        if (activeTaskId === id) {
            renderTaskList();
            renderDetail();
        } else {
            renderTaskList();
        }
        await sleep(30);
    }

    function priorityScore(p) {
        const s = String(p || "").toUpperCase();
        if (s.includes("P0") || s.includes("高")) return 3;
        if (s.includes("P1") || s.includes("中")) return 2;
        return 1;
    }

    function buildOverviewInsights(data, task) {
        const scenarios = data.scenarios || [];
        const sops = data.sops || [];
        const faqs = data.faqs || [];
        const risks = data.risks || [];
        const input = (data.meta && data.meta.input) || (task && task.inputMeta) || {};
        const sessions = (input.sessions && input.sessions.length) || 0;
        const turns = input.turns || 0;
        const chars = input.chars || 0;
        const batches = (data.meta && (data.meta.batches || data.meta.batchCount)) || 1;

        const p0 = scenarios.filter((s) => priorityScore(s.priority) >= 3).length;
        const p1 = scenarios.filter((s) => priorityScore(s.priority) === 2).length;
        const highFreq = scenarios.filter((s) => /高/.test(String(s.frequency || ""))).length;
        const faqCats = {};
        faqs.forEach((f) => {
            const c = f.category || f.catalog || "未分类";
            faqCats[c] = (faqCats[c] || 0) + 1;
        });
        const topCats = Object.keys(faqCats).sort((a, b) => faqCats[b] - faqCats[a]).slice(0, 5)
            .map((k) => ({ name: k, count: faqCats[k] }));
        const maxCat = topCats.length ? topCats[0].count : 1;

        // readiness: coverage of P0 + SOP + FAQ depth
        let score = 35;
        score += Math.min(25, scenarios.length * 6);
        score += Math.min(15, sops.length * 5);
        score += Math.min(15, faqs.length * 2);
        score += p0 >= 2 ? 8 : (p0 ? 4 : 0);
        score -= Math.min(12, risks.filter((r) => /高/.test(String(r.level || ""))).length * 6);
        score = Math.max(20, Math.min(96, score));

        const readiness = score >= 80 ? "可试点上线" : (score >= 60 ? "建议小范围灰度" : "需补齐资产后再上线");
        const narrative = [
            "基于 " + sessions + " 段对话 / " + turns + " 轮交互，识别出 " + scenarios.length + " 个业务场景。",
            "其中 P0 " + p0 + " 个、高频 " + highFreq + " 个，建议优先覆盖机器人首轮应答与转人工边界。",
            "当前沉淀 " + sops.length + " 条 SOP、" + faqs.length + " 条 FAQ" + (topCats.length ? ("，知识集中在「" + topCats[0].name + "」等目录") : "") + "。",
            risks.length ? ("仍有 " + risks.length + " 个风险点需业务确认后再全量放开。") : "暂未发现阻断性风险，可进入试点验证。"
        ];

        const roadmap = [
            { phase: "W1", title: "导入 P0 场景 FAQ", detail: (scenarios.filter((s) => priorityScore(s.priority) >= 3).map((s) => s.name).slice(0, 3).join("、") || "优先场景") + " 进入机器人，并开启人工抽检。" },
            { phase: "W2", title: "挂载 SOP 与升级策略", detail: "把 " + Math.min(sops.length, 3) + " 条核心 SOP 配置到流程引擎，明确升级条件与时效口径。" },
            { phase: "W3", title: "扩充相似问与目录", detail: "围绕 Top FAQ 补口语相似问，按目录做召回评测，目标命中率提升。" },
            { phase: "W4", title: "风险闭环与扩量", detail: risks.length ? ("先处理：" + (risks[0].title || "高优风险") + "，再逐步放开中低频场景。") : "完成灰度复盘后扩大自动应答比例。" }
        ];

        const actions = [];
        if (p0) actions.push("本周上线 " + p0 + " 个 P0 场景的标准问与答复");
        if (sops.length) actions.push("审核并固化 " + Math.min(2, sops.length) + " 条高频 SOP 步骤与升级话术");
        if (faqs.length >= 3) actions.push("选取 Top " + Math.min(10, faqs.length) + " FAQ 做相似问扩充与回归测试");
        if (risks.length) actions.push("组织业务确认风险口径：" + (risks[0].title || "首个风险项"));
        if (!actions.length) actions.push("补充更多真实对话后重新分析，以提高冷启动覆盖度");

        return {
            sessions, turns, chars, batches, p0, p1, highFreq, topCats, maxCat,
            score, readiness, narrative, roadmap, actions,
            counts: { scenarios: scenarios.length, sops: sops.length, faqs: faqs.length, risks: risks.length }
        };
    }

    function renderOverview(data, task) {
        const insights = buildOverviewInsights(data, task);
        const scenarios = data.scenarios || [];
        const modeLabel = (data.meta && String(data.meta.mode || "").indexOf("offline") >= 0)
            ? ("离线分批 ×" + insights.batches)
            : ("API 分批 ×" + insights.batches);

        return ''
            + '<div class="sc-item"><h4>执行摘要</h4><p>' + esc(data.summary || "已完成分析") + "</p>"
            + '<div class="sc-chips">'
            + '<span class="sc-chip ok">' + esc(modeLabel) + "</span>"
            + '<span class="sc-chip">' + insights.counts.scenarios + " 场景</span>"
            + '<span class="sc-chip">' + insights.counts.sops + " SOP</span>"
            + '<span class="sc-chip">' + insights.counts.faqs + " FAQ</span>"
            + '<span class="sc-chip warn">' + insights.counts.risks + " 风险</span>"
            + '<span class="sc-chip">' + esc(insights.readiness) + "</span>"
            + "</div></div>"

            + '<div class="ov-kpis">'
            + '<div class="ov-kpi"><div class="v">' + insights.score + '</div><div class="l">冷启动就绪度</div><div class="ov-bar"><i style="width:' + insights.score + '%"></i></div></div>'
            + '<div class="ov-kpi"><div class="v">' + insights.p0 + '</div><div class="l">P0 场景</div></div>'
            + '<div class="ov-kpi"><div class="v">' + insights.sessions + '</div><div class="l">对话段数</div></div>'
            + '<div class="ov-kpi"><div class="v">' + insights.counts.faqs + '</div><div class="l">可导入 FAQ</div></div>'
            + "</div>"

            + '<div class="ov-grid" style="margin-top:10px;">'
            + '<div class="sc-item"><h4>总览再分析</h4><ul class="ov-list">'
            + insights.narrative.map((x) => "<li>" + esc(x) + "</li>").join("")
            + '</ul></div>'
            + '<div class="sc-item"><h4>知识目录分布</h4>'
            + (insights.topCats.length ? insights.topCats.map((c) =>
                '<div class="ov-row"><span>' + esc(c.name) + "</span><span>" + c.count + "</span></div>"
                + '<div class="ov-bar"><i style="width:' + Math.max(8, Math.round(c.count / insights.maxCat * 100)) + '%"></i></div>'
              ).join("") : '<p class="muted">暂无目录统计</p>')
            + "</div></div>"

            + '<div class="sc-item"><h4>建议上线路线图</h4><div class="ov-roadmap">'
            + insights.roadmap.map((r) =>
                '<div class="ov-step"><div class="phase">' + esc(r.phase) + '</div><div><strong>' + esc(r.title)
                + '</strong><div class="muted" style="margin-top:4px;">' + esc(r.detail) + "</div></div></div>"
              ).join("")
            + "</div></div>"

            + '<div class="sc-item"><h4>本周行动清单</h4><ol class="ov-list">'
            + insights.actions.map((a) => "<li>" + esc(a) + "</li>").join("")
            + "</ol></div>"

            + '<div class="sc-item"><h4>优先场景队列</h4><ol>'
            + (scenarios.slice().sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority)).slice(0, 5)
                .map((s) => "<li><strong>" + esc(s.name) + "</strong> — " + esc(s.priority || "P1") + " / " + esc(s.frequency || "")
                + (s.intent ? (" · " + esc(s.intent)) : "") + "</li>").join("") || "<li>暂无</li>")
            + "</ol></div>";
    }

    function renderResult(data) {
        const task = getTask(activeTaskId);
        const scenarios = data.scenarios || [];
        const sops = data.sops || [];
        const faqs = data.faqs || [];
        const risks = data.risks || [];

        $("pane-overview").innerHTML = renderOverview(data, task);

        $("pane-scenarios").innerHTML = scenarios.length ? scenarios.map((s) =>
            '<div class="sc-item"><h4>' + esc(s.name) + "</h4><p>" + esc(s.description) + '</p><div class="sc-chips">' +
            (s.intent ? '<span class="sc-chip muted">' + esc(s.intent) + "</span>" : "") +
            (s.frequency ? '<span class="sc-chip">' + esc("频次 " + s.frequency) + "</span>" : "") +
            (s.priority ? '<span class="sc-chip ok">' + esc(s.priority) + "</span>" : "") +
            "</div></div>"
        ).join("") : '<div class="sc-empty">暂无场景</div>';

        $("pane-sops").innerHTML = sops.length ? sops.map((s) =>
            '<div class="sc-item"><h4>' + esc(s.scenario) + "</h4>" +
            (s.goal ? "<p><strong>目标：</strong>" + esc(s.goal) + "</p>" : "") +
            "<ol>" + (s.steps || []).map((step) => "<li>" + esc(step) + "</li>").join("") + "</ol>" +
            (s.escalation ? '<p style="margin-top:8px;"><strong>升级条件：</strong>' + esc(s.escalation) + "</p>" : "") +
            "</div>"
        ).join("") : '<div class="sc-empty">暂无 SOP</div>';

        $("pane-faqs").innerHTML = faqs.length ? faqs.map((f) =>
            '<div class="sc-item"><h4>Q：' + esc(f.question) + "</h4><p>A：" + esc(f.answer) + '</p><div class="sc-chips">' +
            (f.category ? '<span class="sc-chip muted">' + esc(f.category) + "</span>" : "") +
            (f.priority ? '<span class="sc-chip">' + esc(f.priority) + "</span>" : "") +
            "</div>" +
            (Array.isArray(f.similar) && f.similar.length
                ? '<div class="sc-similar">相似问：' + f.similar.map((x) => "<span>" + esc(x) + "</span>").join("") + "</div>"
                : "") +
            "</div>"
        ).join("") : '<div class="sc-empty">暂无 FAQ</div>';

        $("pane-risks").innerHTML = risks.length ? risks.map((r) =>
            '<div class="sc-item"><h4>' + esc(r.title || "风险项") + "</h4><p>" + esc(r.detail || "") +
            '</p><div class="sc-chips"><span class="sc-chip warn">' + esc("等级 " + (r.level || "中")) + "</span></div></div>"
        ).join("") : '<div class="sc-empty">未发现明显风险</div>';
    }

    function switchPane(btn) {
        document.querySelectorAll(".sc-rtab").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        $("pane-" + btn.dataset.pane).classList.add("active");
    }

    function createTaskFromForm() {
        const text = $("chatInput").value.trim();
        let company = $("companyName").value.trim();
        const brief = $("companyBrief").value.trim();
        const focus = $("focus").value;
        const industry = $("industry").value;
        const genSimilar = $("genSimilar").checked;
        const offlineDemo = $("offlineDemo").checked;
        let name = $("taskName").value.trim();

        if (!text) {
            toast("请先上传或粘贴对话/FAQ");
            banner("缺少输入内容：请上传表格或粘贴对话后再创建任务。", "warn");
            $("chatInput").focus();
            return null;
        }
        if (!company) {
            company = "未命名品牌";
            $("companyName").value = company;
        }
        if (looksBinary(text) || /docProps\/|xl\/sharedStrings\.xml|\[Content_Types\]\.xml/i.test(text)) {
            toast("内容像 Excel 二进制乱码，请重新上传 .xlsx/.csv");
            banner("检测到乱码输入。请重新上传 Excel/CSV，不要用记事本直接打开 xlsx。", "err");
            return null;
        }

        let body = text;
        if (body.length > MAX_INPUT_CHARS) {
            toast("文件过大，已限制在 " + MAX_INPUT_CHARS + " 字内（约可覆盖海量会话，将自动分批）");
            body = body.slice(0, MAX_INPUT_CHARS);
        }
        if (!name) {
            name = company + "冷启动-" + fmtTime(nowISO()).replace(" ", "-");
            $("taskName").value = name;
        }

        const meta = parseDialogues(body);
        const task = {
            id: uid(),
            name,
            status: "queued",
            createdAt: nowISO(),
            updatedAt: nowISO(),
            config: { company, brief, focus, industry, genSimilar, offlineDemo },
            input: body,
            inputMeta: meta,
            progress: { step: "parse", pct: 0, message: "任务已创建，排队执行中…" },
            result: null,
            error: ""
        };
        if (task.id) inputStore.set(task.id, body);
        tasks.unshift(task);
            activeTaskId = task.id;
            saveTasks();
            return task;
    }

    async function runTask(taskId) {
        if (running) { toast("已有任务在运行，请稍候"); return; }
        const task = getTask(taskId);
        if (!task) return;
        running = true;
        const btn = $("createTaskBtn");
        const prevLabel = btn ? btn.textContent : "";
        if (btn) { btn.disabled = true; btn.textContent = "任务执行中…"; }
        banner("任务「" + task.name + "」已进入执行队列，请看右侧进度条。", "");
        setActive(taskId);

        try {
            const fullText = getTaskInput(task) || task.input || "";
            if (task.id) inputStore.set(task.id, fullText);

            await updateTaskProgress(taskId, "parse", 8, "正在本地解析输入…");
            const meta = parseDialogues(fullText);
            task.inputMeta = meta;
            const batches = splitTextIntoBatches(fullText, BATCH_CHARS);
            task.batchCount = batches.length;
            await updateTaskProgress(taskId, "parse", 14, "已解析 " + meta.sessions.length + " 段，将分 " + batches.length + " 批处理…");

            let data;
            if (task.config.offlineDemo) {
                const parts = [];
                for (let i = 0; i < batches.length; i++) {
                    const pct = 20 + Math.floor(((i + 1) / batches.length) * 65);
                    await updateTaskProgress(taskId, i < batches.length / 2 ? "scene" : "faq", pct,
                        "离线分批处理 " + (i + 1) + "/" + batches.length + "…");
                    await sleep(120);
                    const batchMeta = parseDialogues(batches[i]);
                    const part = buildOfflineResult(task.config.company, task.config.brief, batchMeta);
                    const extracted = extractFaqsFromText(batches[i], 6);
                    if (extracted.length) {
                        const seen = new Set((part.faqs || []).map((f) => (f.question || "").toLowerCase()));
                        extracted.forEach((f) => {
                            const k = (f.question || "").toLowerCase();
                            if (k && !seen.has(k)) { part.faqs.push(f); seen.add(k); }
                        });
                        part.summary += "；本批抽取 " + extracted.length + " 条 FAQ";
                    }
                    parts.push(part);
                }
                data = mergeAnalysisResults(parts, task.config.company, task.config.brief, meta, "offline-batch");
            } else {
                try {
                    const parts = [];
                    for (let i = 0; i < batches.length; i++) {
                        const pct = 18 + Math.floor(((i + 1) / batches.length) * 70);
                        await updateTaskProgress(taskId, "scene", pct,
                            "API 分批分析 " + (i + 1) + "/" + batches.length + "…");
                        const batchMeta = parseDialogues(batches[i]);
                        const part = await analyzeWithAPI(task, batches[i], batchMeta);
                        parts.push(part);
                    }
                    data = mergeAnalysisResults(parts, task.config.company, task.config.brief, meta, "api-batch");
                } catch (err) {
                    console.warn(err);
                    banner("API 暂不可用（" + (err && err.message ? err.message : "timeout") + "），已自动切换离线分批演示。", "warn");
                    const parts = [];
                    for (let i = 0; i < batches.length; i++) {
                        const pct = 30 + Math.floor(((i + 1) / batches.length) * 55);
                        await updateTaskProgress(taskId, "faq", pct, "离线分批 " + (i + 1) + "/" + batches.length + "…");
                        await sleep(100);
                        const part = buildOfflineResult(task.config.company, task.config.brief, parseDialogues(batches[i]));
                        const extracted = extractFaqsFromText(batches[i], 6);
                        if (extracted.length) {
                            const seen = new Set((part.faqs || []).map((f) => (f.question || "").toLowerCase()));
                            extracted.forEach((f) => {
                                const k = (f.question || "").toLowerCase();
                                if (k && !seen.has(k)) { part.faqs.push(f); seen.add(k); }
                            });
                        }
                        parts.push(part);
                    }
                    data = mergeAnalysisResults(parts, task.config.company, task.config.brief, meta, "offline-batch-fallback");
                    data.meta.fallbackFromApiError = String(err && err.message || err);
                }
            }

            await updateTaskProgress(taskId, "review", 96, "正在汇总 " + batches.length + " 批结果…");
            task.result = data;
            task.status = "done";
            task.progress = { step: "review", pct: 100, message: "任务完成（" + batches.length + " 批）" };
            task.finishedAt = nowISO();
            task.error = "";
            saveTasks();
            renderTaskList();
            renderDetail();
            banner("任务完成：" + task.name + "（" + batches.length + " 批 / " + ((data.scenarios || []).length) + " 场景 / " + ((data.faqs || []).length) + " FAQ）", "ok");
            toast("任务完成 · 已分批处理并汇总");
        } catch (e) {
            task.status = "failed";
            task.error = e && e.message ? e.message : String(e);
            task.progress = { step: (task.progress && task.progress.step) || "parse", pct: (task.progress && task.progress.pct) || 0, message: "任务失败" };
            task.updatedAt = nowISO();
            saveTasks();
            renderTaskList();
            renderDetail();
            banner("任务失败：" + task.error, "err");
            toast("任务失败：" + task.error);
        } finally {
            running = false;
            if (btn) {
                btn.disabled = false;
                btn.textContent = prevLabel || "创建并开始任务";
            }
        }
    }

    function currentTask() {
        return getTask(activeTaskId);
    }

    function buildCustomerReportHTML(task) {
        const data = task && task.result ? task.result : null;
        if (!data) return "";
        const company = (task.config && task.config.company) || (data.meta && data.meta.company) || "客户品牌";
        const brief = (task.config && task.config.brief) || (data.meta && data.meta.brief) || "";
        const industry = industryLabel((task.config && task.config.industry) || "general");
        const insights = buildOverviewInsights(data, task);
        const scenarios = data.scenarios || [];
        const sops = data.sops || [];
        const faqs = data.faqs || [];
        const risks = data.risks || [];
        const genAt = (data.meta && (data.meta.generatedAt || data.meta.createdAt)) || task.finishedAt || task.createdAt || "";
        const dateLabel = genAt ? fmtTime(genAt) : "";
        const safeName = String(company).replace(/[^\w\u4e00-\u9fa5\-]+/g, "_").slice(0, 40);

        const catHtml = insights.topCats.length
            ? insights.topCats.map((c) => {
                const pct = Math.max(8, Math.round((c.count / Math.max(insights.maxCat, 1)) * 100));
                return '<div class="dist-row"><div class="dist-label"><span>' + esc(c.name) + '</span><span>' + c.count +
                    '</span></div><div class="dist-bar"><i style="width:' + pct + '%"></i></div></div>';
            }).join("")
            : '<p class="note">暂无目录分布</p>';

        const narrativeHtml = insights.narrative.map((x) => "<li>" + esc(x) + "</li>").join("");
        const actionsHtml = insights.actions.map((x) => "<li>" + esc(x) + "</li>").join("");
        const roadmapHtml = insights.roadmap.map((r) =>
            '<div class="road-item"><div class="road-phase">' + esc(r.phase) + '</div><div><strong>' +
            esc(r.title) + '</strong><p>' + esc(r.detail) + '</p></div></div>'
        ).join("");

        const scenarioHtml = scenarios.slice().sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority)).map((s, i) =>
            '<article class="card"><div class="card-kicker">场景 ' + String(i + 1).padStart(2, "0") +
            ' · ' + esc(s.priority || "P1") + '</div><h3>' + esc(s.name) + '</h3><p>' + esc(s.description || "") +
            '</p><div class="tags">' +
            (s.frequency ? '<span>' + esc("频次 " + s.frequency) + '</span>' : '') +
            (s.intent ? '<span>' + esc(s.intent) + '</span>' : '') +
            '</div></article>'
        ).join("") || '<p class="note">暂无场景</p>';

        const sopHtml = sops.map((s) =>
            '<article class="card"><div class="card-kicker">SOP</div><h3>' + esc(s.scenario || s.name || "流程") +
            '</h3>' + (s.goal ? '<p><strong>目标：</strong>' + esc(s.goal) + '</p>' : '') +
            '<ol>' + (s.steps || []).map((step) => '<li>' + esc(step) + '</li>').join('') + '</ol>' +
            (s.escalation ? '<p class="note">升级：' + esc(s.escalation) + '</p>' : '') +
            '</article>'
        ).join('') || '<p class="note">暂无 SOP</p>';

        const faqHtml = faqs.slice(0, 20).map((f) =>
            '<article class="faq"><h3>Q：' + esc(f.question) + '</h3><p>A：' + esc(f.answer) + '</p><div class="tags">' +
            (f.category ? '<span>' + esc(f.category) + '</span>' : '') +
            (f.priority ? '<span>' + esc(f.priority) + '</span>' : '') +
            '</div>' +
            (Array.isArray(f.similar) && f.similar.length
                ? '<div class="similar">相似问：' + f.similar.map((x) => esc(x)).join('、') + '</div>'
                : '') +
            '</article>'
        ).join('') || '<p class="note">暂无 FAQ</p>';

        const riskHtml = risks.length
            ? risks.map((r) =>
                '<article class="risk"><div class="risk-level">' + esc(r.level || "中") +
                '</div><div><h3>' + esc(r.title || "风险项") + '</h3><p>' + esc(r.detail || "") +
                '</p></div></article>'
              ).join('')
            : '<p class="note">未发现明显风险</p>';

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(company)} · AI客服冷启动报告</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{--bg:#f4f7fb;--ink:#0f172a;--muted:#5b6b7c;--line:rgba(15,23,42,.08);--card:rgba(255,255,255,.84);--teal:#0f766e;--cyan:#0284c7;--mint:#059669;--warn:#b45309;--shadow:0 18px 50px rgba(15,23,42,.08)}
*{box-sizing:border-box}body{margin:0;font-family:"IBM Plex Sans",system-ui,sans-serif;color:var(--ink);background:radial-gradient(1100px 500px at 10% -10%,rgba(14,165,233,.18),transparent 55%),radial-gradient(900px 480px at 100% 0%,rgba(16,185,129,.14),transparent 50%),linear-gradient(180deg,#eef5fb 0%,#f7fafc 42%,#f3f6fa 100%)}
.wrap{max-width:1080px;margin:0 auto;padding:36px 20px 80px}
.hero{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:28px;padding:42px 40px;background:linear-gradient(135deg,rgba(255,255,255,.92),rgba(255,255,255,.72));box-shadow:var(--shadow)}
.hero::after{content:"";position:absolute;right:-80px;top:-80px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(2,132,199,.18),transparent 70%)}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--teal);margin-bottom:14px}
.hero h1{font-family:Fraunces,Georgia,serif;font-size:clamp(34px,5vw,52px);line-height:1.08;margin:0 0 12px;letter-spacing:-.03em;max-width:16ch}
.lead{font-size:16px;color:var(--muted);max-width:56ch;line-height:1.7;margin:0}
.hero-meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.pill{border:1px solid var(--line);background:rgba(255,255,255,.7);border-radius:999px;padding:7px 12px;font-size:12px;font-weight:600;color:var(--muted)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
.btn{border:0;border-radius:12px;padding:11px 16px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#0ea5e9,#0f766e);color:#fff;font-size:13px}
.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0 8px}
.kpi{border:1px solid var(--line);border-radius:18px;padding:16px;background:var(--card);box-shadow:var(--shadow)}
.kpi .n{font-family:"IBM Plex Mono",monospace;font-size:28px;font-weight:700;color:var(--cyan)}
.kpi .l{font-size:12px;color:var(--muted);margin-top:4px}
.score-bar{height:8px;border-radius:999px;background:rgba(15,23,42,.08);overflow:hidden;margin-top:10px}
.score-bar>i{display:block;height:100%;background:linear-gradient(90deg,#0284c7,#059669)}
section{margin-top:28px}
.sec-title{display:flex;justify-content:space-between;gap:12px;align-items:end;margin-bottom:12px}
.sec-title h2{font-family:Fraunces,Georgia,serif;font-size:28px;margin:0;letter-spacing:-.02em}
.sec-title p{margin:0;color:var(--muted);font-size:13px}
.grid-2{display:grid;grid-template-columns:1.1fr .9fr;gap:14px}
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.panel,.card,.faq,.risk{border:1px solid var(--line);border-radius:18px;background:var(--card);box-shadow:var(--shadow);padding:16px 18px}
.card h3,.faq h3,.risk h3,.panel h3{margin:0 0 8px;font-size:16px}
.card p,.faq p,.risk p,.panel p,li{color:var(--muted);line-height:1.65;font-size:14px}
.card-kicker{font-size:11px;font-weight:700;color:var(--teal);letter-spacing:.04em;margin-bottom:6px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.tags span{font-size:11px;font-weight:600;padding:4px 8px;border-radius:999px;background:rgba(2,132,199,.08);color:#0369a1;border:1px solid rgba(2,132,199,.12)}
.similar{margin-top:8px;font-size:12px;color:var(--muted)}
.note{color:var(--muted);font-size:13px}
.dist-row{margin-top:10px}
.dist-label{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}
.dist-bar{height:8px;border-radius:999px;background:rgba(15,23,42,.08);overflow:hidden;margin-top:5px}
.dist-bar>i{display:block;height:100%;background:linear-gradient(90deg,#0284c7,#0f766e)}
.road-item{display:grid;grid-template-columns:64px 1fr;gap:12px;padding:12px 0;border-bottom:1px dashed var(--line)}
.road-item:last-child{border-bottom:0}
.road-phase{font-family:"IBM Plex Mono",monospace;font-weight:700;color:var(--cyan);background:rgba(2,132,199,.08);border-radius:10px;text-align:center;padding:8px 0;height:fit-content}
.risk{display:grid;grid-template-columns:52px 1fr;gap:12px;align-items:start;margin-bottom:10px}
.risk-level{font-size:12px;font-weight:700;text-align:center;border-radius:10px;padding:8px 0;background:rgba(180,83,9,.1);color:var(--warn)}
footer{margin-top:36px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media (max-width:900px){.kpis,.grid-2,.grid-3{grid-template-columns:1fr}.hero{padding:28px 22px}}
@media print{body{background:#fff}.actions{display:none}.hero,.panel,.card,.faq,.kpi,.risk{box-shadow:none}}
</style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div class="eyebrow">SmartCS Cold Start Report</div>
      <h1>${esc(company)}</h1>
      <p class="lead">${esc(data.summary || (company + " AI 客服冷启动资产包已生成，可用于机器人首期上线与知识库导入。"))}</p>
      <div class="hero-meta">
    <span class="pill">行业 · ${esc(industry)}</span>
    <span class="pill">就绪度 · ${insights.score} / 100 · ${esc(insights.readiness)}</span>
    <span class="pill">生成 · ${esc(dateLabel || "-")}</span>
    ${brief ? `<span class="pill">背景 · ${esc(brief.slice(0, 36))}${brief.length > 36 ? "…" : ""}</span>` : ""}
      </div>
      <div class="actions">
    <button class="btn" onclick="window.print()">打印 / 另存 PDF</button>
    <button class="btn secondary" onclick="window.scrollTo({top:document.body.scrollHeight, behavior:'smooth'})">查看行动清单</button>
      </div>
    </header>

    <div class="kpis">
      <div class="kpi"><div class="n">${insights.score}</div><div class="l">冷启动就绪度</div><div class="score-bar"><i style="width:${insights.score}%"></i></div></div>
      <div class="kpi"><div class="n">${insights.counts.scenarios}</div><div class="l">业务场景</div></div>
      <div class="kpi"><div class="n">${insights.counts.sops}</div><div class="l">SOP 流程</div></div>
      <div class="kpi"><div class="n">${insights.counts.faqs}</div><div class="l">FAQ 知识</div></div>
    </div>

    <section>
      <div class="sec-title"><h2>总览洞察</h2><p>对原始对话的二次诊断与上线建议</p></div>
      <div class="grid-2">
    <div class="panel">
      <h3>关键结论</h3>
      <ul>${narrativeHtml}</ul>
      <h3 style="margin-top:16px;">本周行动</h3>
      <ol>${actionsHtml}</ol>
    </div>
    <div class="panel">
      <h3>知识目录分布</h3>
      ${catHtml}
      <div style="margin-top:16px;font-size:12px;color:var(--muted)">
        输入规模：${insights.sessions} 段 / ${insights.turns} 轮 / ${insights.chars} 字 · 分批 ${insights.batches}
      </div>
    </div>
      </div>
    </section>

    <section>
      <div class="sec-title"><h2>上线路线图</h2><p>建议按周推进，先 P0 后扩量</p></div>
      <div class="panel">${roadmapHtml}</div>
    </section>

    <section>
      <div class="sec-title"><h2>优先场景</h2><p>按优先级排序，适合首期机器人覆盖</p></div>
      <div class="grid-3">${scenarioHtml}</div>
    </section>

    <section>
      <div class="sec-title"><h2>核心 SOP</h2><p>可直接配置到流程或坐席辅助</p></div>
      <div class="grid-2">${sopHtml}</div>
    </section>

    <section>
      <div class="sec-title"><h2>FAQ 知识包</h2><p>展示前 ${Math.min(20, faqs.length)} 条，可导入知识库</p></div>
      <div class="grid-2">${faqHtml}</div>
    </section>

    <section>
      <div class="sec-title"><h2>风险与边界</h2><p>上线前建议业务确认</p></div>
      ${riskHtml}
    </section>

    <footer>
      <div>由 SmartCS 冷启动系统生成 · 可供客户评审与归档</div>
      <div>${esc(safeName)}-coldstart-report</div>
    </footer>
  </div>
</body>
</html>`;
    }

    function openCustomerReport(download) {
        const task = currentTask();
        if (!task || !task.result) { toast("请先完成一个任务再导出报告"); return; }
        const html = buildCustomerReportHTML(task);
        if (!html) { toast("报告生成失败"); return; }
        const company = (task.config && task.config.company) || "customer";
        const filename = String(company).replace(/[^\w\u4e00-\u9fa5\-]+/g, "_").slice(0, 40) + "-冷启动报告.html";
        if (download) {
            downloadBlob(filename, html, "text/html;charset=utf-8");
            banner("客户报告已导出：" + filename + "（可直接发给客户或浏览器打开）", "ok");
            toast("客户报告已下载");
            return;
        }
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const win = window.open(url, "_blank");
        if (!win) {
            downloadBlob(filename, html, "text/html;charset=utf-8");
            toast("弹窗被拦截，已改为下载报告");
        } else {
            toast("已打开客户报告预览");
        }
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    function downloadBlob(filename, content, type) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([content], { type: type }));
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function currentResult() {
        const t = getTask(activeTaskId);
        return t && t.result ? t.result : null;
    }

    function downloadJSON() {
        const r = currentResult(); if (!r) return;
        downloadBlob("smartcs-task.json", JSON.stringify(r, null, 2), "application/json");
    }
    function downloadMarkdown() {
        const r = currentResult(); if (!r) return;
        let md = "# " + ((r.meta && r.meta.company) || "AI客服") + " 冷启动报告\n\n" + (r.summary || "") + "\n\n## 场景\n";
        (r.scenarios || []).forEach((s) => { md += "\n### " + s.name + "\n- 描述：" + (s.description || "") + "\n- 优先级：" + (s.priority || "") + "\n"; });
        md += "\n## SOP\n";
        (r.sops || []).forEach((s) => {
            md += "\n### " + s.scenario + "\n";
            (s.steps || []).forEach((step, i) => { md += (i + 1) + ". " + step + "\n"; });
        });
        md += "\n## FAQ\n";
        (r.faqs || []).forEach((f) => { md += "\n### Q：" + f.question + "\nA：" + f.answer + "\n"; });
        downloadBlob("smartcs-task.md", md, "text/markdown;charset=utf-8");
    }
    function downloadCSV() {
        const r = currentResult();
        if (!r || !r.faqs || !r.faqs.length) { toast("没有可导出的 FAQ"); return; }
        const rows = [["category", "question", "answer", "priority", "similar"]];
        r.faqs.forEach((f) => {
            rows.push([f.category || "", f.question || "", f.answer || "", f.priority || "", (f.similar || []).join("|")]
                .map((v) => '"' + String(v).replace(/"/g, '""') + '"'));
        });
        downloadBlob("smartcs-task-faq.csv", rows.map((x) => x.join(",")).join("\n"), "text/csv;charset=utf-8");
    }
    function copyFAQ() {
        const r = currentResult();
        if (!r || !r.faqs || !r.faqs.length) return;
        const text = r.faqs.map((f) => "Q：" + f.question + "\nA：" + f.answer).join("\n\n");
        navigator.clipboard.writeText(text).then(() => toast("FAQ 已复制")).catch(() => toast("复制失败"));
    }



    function bindCreatePage() {
        on("fileInput", "change", async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            $("fileName").textContent = "正在解析：" + file.name + " …";
            try {
                const { text, meta } = await readUploadFile(file);
                if (looksBinary(text)) throw new Error("解析结果仍像乱码，请检查表头是否含问题/答案列");
                let body = text;
                let note = "";
                if (body.length > MAX_INPUT_CHARS) {
                    body = body.slice(0, MAX_INPUT_CHARS);
                    note = "（超过硬上限，已限制至 " + MAX_INPUT_CHARS + " 字）";
                }
                const batchHint = Math.max(1, Math.ceil(body.length / BATCH_CHARS));
                if (batchHint > 1) note += (note ? " " : "") + "· 将分 " + batchHint + " 批处理（不截断会话）";
                $("chatInput").value = body;
                $("fileName").textContent = "已选择：" + file.name + " · " + meta + (note ? " " + note : "");
                if ($("taskName") && !$("taskName").value.trim()) $("taskName").value = file.name.replace(/\.[^.]+$/, "") + "-冷启动";
                refreshInputStats();
                banner("文件解析完成，可点击「创建并开始任务」。", "ok");
                toast("文件解析完成");
            } catch (err) {
                if ($("chatInput")) $("chatInput").value = "";
                if ($("fileName")) $("fileName").textContent = "";
                if ($("fileInput")) $("fileInput").value = "";
                refreshInputStats();
                banner("上传失败：" + (err && err.message ? err.message : "无法解析"), "err");
                toast("上传失败");
            }
        });
        on("chatInput", "input", refreshInputStats);
        on("sampleBtn", "click", () => {
            if ($("companyName")) $("companyName").value = "示例出行";
            if ($("companyBrief")) $("companyBrief").value = "智能两轮电动车；覆盖充电、配网、物流售后";
            if ($("industry")) $("industry").value = "mobility";
            if ($("chatInput")) $("chatInput").value = SAMPLE;
            if ($("taskName")) $("taskName").value = "示例出行-冷启动演示";
            if ($("fileName")) $("fileName").textContent = "已载入内置示例对话（3 段）";
            if ($("offlineDemo")) $("offlineDemo").checked = true;
            refreshInputStats();
            banner("示例已载入。直接点「创建并开始任务」即可看到完整流程。", "ok");
            toast("示例对话已载入");
        });
        on("clearInputBtn", "click", () => {
            if ($("chatInput")) $("chatInput").value = "";
            if ($("fileName")) $("fileName").textContent = "";
            if ($("fileInput")) $("fileInput").value = "";
            refreshInputStats();
        });
        on("createTaskBtn", "click", async () => {
            try {
                banner("正在创建任务…", "");
                const task = createTaskFromForm();
                if (!task) return;
                toast("任务已创建：" + task.name);
                // jump to detail page and continue running there
                sessionStorage.setItem("smartcs_autorun", task.id);
                location.href = "task.html?id=" + encodeURIComponent(task.id);
            } catch (err) {
                console.error(err);
                banner("创建任务出错：" + (err && err.message ? err.message : String(err)), "err");
                toast("创建失败，请刷新后重试");
            }
        });
        refreshInputStats();
        fetch("/api/deepseek", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
            .then((r) => {
                if ((r.status === 502 || r.status >= 500) && $("offlineDemo")) {
                    $("offlineDemo").checked = true;
                    banner("检测到 DeepSeek API 当前不可用，已默认勾选离线演示。", "warn");
                } else {
                    banner("填写配置并上传对话后，将创建独立分析任务。", "ok");
                }
            })
            .catch(() => {
                if ($("offlineDemo")) $("offlineDemo").checked = true;
                banner("无法连接分析 API，已默认离线演示模式。", "warn");
            });
    }

    function bindDashboardPage() {
        on("clearTasksBtn", "click", () => {
            if (!tasks.length) return;
            if (!confirm("确认清空全部任务历史？")) return;
            tasks = [];
            activeTaskId = null;
            saveTasks();
            renderTaskList();
            banner("任务历史已清空。", "");
        });
        renderTaskList();
        const running = tasks.find((t) => t.status === "running" || t.status === "queued");
        if (running) banner("有任务仍在队列中，可进入详情查看进度。", "warn");
        else if (tasks.length) banner("共 " + tasks.length + " 个分析任务。点击卡片进入详情与导出。", "ok");
        else banner("还没有任务。先去「新建分析」上传对话或载入示例。", "");
    }

    function bindDetailPage() {
        const id = qs("id") || sessionStorage.getItem("smartcs_autorun");
        if (!id || !getTask(id)) {
            if ($("detailEmpty")) $("detailEmpty").style.display = "block";
            if ($("detailBody")) $("detailBody").style.display = "none";
            banner("未找到任务，请返回任务台重新选择。", "warn");
            return;
        }
        activeTaskId = id;
        on("resultTabs", "click", (e) => {
            const btn = e.target.closest(".sc-rtab");
            if (btn) switchPane(btn);
        });
        on("btnJson", "click", downloadJSON);
        on("btnMd", "click", downloadMarkdown);
        on("btnCsv", "click", downloadCSV);
        on("btnCopy", "click", copyFAQ);
        on("btnReport", "click", () => openCustomerReport(true));
        on("btnPreviewReport", "click", () => openCustomerReport(false));
        on("rerunBtn", "click", async () => {
            const t = getTask(activeTaskId);
            if (!t) return;
            t.status = "queued";
            t.result = null;
            t.error = "";
            t.progress = { step: "parse", pct: 0, message: "重新排队" };
            saveTasks();
            await runTask(t.id);
        });
        renderDetail();
        const autorun = sessionStorage.getItem("smartcs_autorun");
        if (autorun && autorun === id) {
            sessionStorage.removeItem("smartcs_autorun");
            const t = getTask(id);
            if (t && (t.status === "queued" || t.status === "running" || !t.result)) {
                runTask(id);
            }
        } else if (getTask(id) && getTask(id).status === "queued" && !getTask(id).result) {
            runTask(id);
        }
    }

    // boot by page
    if (page === "create") bindCreatePage();
    else if (page === "detail") bindDetailPage();
    else bindDashboardPage();

})();
