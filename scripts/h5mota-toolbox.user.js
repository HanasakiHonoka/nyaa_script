// ==UserScript==
// @name         H5魔塔工具箱
// @namespace    hsjje-h5mota-toolbox
// @version      2.2.2
// @description  血瓶拾取/使用倍率 + 楼层传送器无视楼梯限制 + 扣血转加血(战斗) + 回春触发计算 + 楼层敌人统计 + 撤销悬浮按钮 + 楼传滚动条；配置按魔塔独立存储，新塔默认全关。适用于 HTML5魔塔引擎（土豆魔塔）游戏
// @author       hsjje
// @match        http://127.0.0.1/*
// @match        http://localhost/*
// @match        https://h5mota.com/*
// @match        file:///*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/HanasakiHonoka/nyaa_script/main/scripts/h5mota-toolbox.user.js
// @updateURL    https://raw.githubusercontent.com/HanasakiHonoka/nyaa_script/main/scripts/h5mota-toolbox.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 编辑器页面不注入
    if (/editor/i.test(location.pathname)) return;

    const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    // ---------- 持久化 ----------
    // 以「域名+路径」作为塔标识，各魔塔独立保存一套配置；新塔所有开关默认关闭。
    // 末尾的入口文件名与尾斜杠做了归一化，避免同一目录不同入口被当成两座塔。
    const TOWER_KEY = (function () {
        let p = (location.pathname || '/').replace(/[^\/]*\.html?$/i, '');
        if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
        return 'motaToolbox.' + (location.host || '') + p;
    })();
    const KEY = {
        enabled: TOWER_KEY + '.potionEnabled',
        mult: TOWER_KEY + '.potionMult',
        flyFree: TOWER_KEY + '.flyFree',
        cs: TOWER_KEY + '.csEnabled',
        hpFlip: TOWER_KEY + '.hpFlip',
        selA: TOWER_KEY + '.floorSelA',
        selB: TOWER_KEY + '.floorSelB',
        undoPos: TOWER_KEY + '.undoPos',
        pos: TOWER_KEY + '.pos'
    };

    const hasGM = typeof GM_getValue === 'function';
    function rawLoad(k) {
        try {
            const v = hasGM ? GM_getValue(k) : localStorage.getItem(k);
            return v === undefined || v === null ? undefined : JSON.parse(v);
        } catch (e) { return undefined; }
    }
    function load(k, dft) {
        const v = rawLoad(k);
        return v === undefined ? dft : v;
    }
    function save(k, v) {
        try {
            const s = JSON.stringify(v);
            if (hasGM) GM_setValue(k, s); else localStorage.setItem(k, s);
        } catch (e) { /* ignore */ }
    }
    function rawRemove(k) {
        try {
            if (hasGM && typeof GM_deleteValue === 'function') GM_deleteValue(k);
            else localStorage.removeItem(k);
        } catch (e) { /* ignore */ }
    }
    // 旧版全局单份配置与更早「血瓶倍率助手」的键名已废弃，启动时清理，不做兼容读取
    (function purgeLegacyKeys() {
        ['potionMult.enabled', 'potionMult.mult', 'potionMult.pos',
            'motaToolbox.potionEnabled', 'motaToolbox.potionMult', 'motaToolbox.flyFree',
            'motaToolbox.csEnabled', 'motaToolbox.floorSelA', 'motaToolbox.floorSelB',
            'motaToolbox.pos'].forEach(rawRemove);
    })();

    const state = {
        potionEnabled: load(KEY.enabled, false),
        potionMult: load(KEY.mult, 2),
        flyFree: load(KEY.flyFree, false),
        csEnabled: load(KEY.cs, false),
        hpFlip: load(KEY.hpFlip, false),
        lastGain: 0
    };

    // ---------- 功能一：血瓶倍率 ----------
    function scaleGain(original) {
        function wrapper() {
            const core = W.core;
            // 未启用 / 录像回放校验 / 引擎未就绪 / 塔插件的显示模拟窗口：原样执行
            if (!state.potionEnabled || !core || !core.status || !core.status.hero ||
                (W.main && W.main.replayChecking) ||
                (typeof core.getFlag === 'function' && core.getFlag('__statistics__'))) {
                state.lastGain = 0;
                return original.apply(this, arguments);
            }
            const before = core.status.hero.hp;
            const ret = original.apply(this, arguments);
            // 注意：必须在原函数执行后重新获取 hero 对象。部分塔的"血瓶数据显示"插件
            // 在 updateStatusBar 时用 clone/还原整体替换 core.status.hero（对象身份变化），
            // 若沿用调用前捕获的引用，倍率会写进已脱离游戏的旧对象
            const hero = core.status.hero;
            const gain = hero.hp - before;
            if (gain > 0) {
                const target = before + Math.floor(gain * state.potionMult);
                if (hero.statistics) hero.statistics.hp += target - hero.hp;
                hero.hp = target;
                state.lastGain = target - before;
                try { core.updateStatusBar(false, true); } catch (e) { /* ignore */ }
            } else {
                state.lastGain = 0;
            }
            return ret;
        }
        wrapper.__mtbPotion = true;
        wrapper.__mtbBase = original;
        return wrapper;
    }

    // 看门狗：塔的插件会在游戏启动后重新赋值 items.prototype.getItemEffect（甚至
    // 在 core.items 实例上留下影子属性），一次性补丁会被静默覆盖。持续对账，
    // 发现钩子被顶掉就重新包一层（包的是当时最新的实现，保留塔自己的逻辑）。
    function syncPotionHook() {
        const ctor = W.items;
        if (!ctor || !ctor.prototype) return;
        const inst = W.core && W.core.items;
        ['getItemEffect', '_useItemEffect'].forEach(function (name) {
            const protoFn = ctor.prototype[name];
            if (typeof protoFn === 'function' && !protoFn.__mtbPotion)
                ctor.prototype[name] = scaleGain(protoFn);
            if (inst && Object.prototype.hasOwnProperty.call(inst, name)) {
                const ownFn = inst[name];
                if (typeof ownFn === 'function' && !ownFn.__mtbPotion)
                    inst[name] = scaleGain(ownFn);
            }
        });
    }
    setInterval(syncPotionHook, 300);

    // ---------- 功能二：楼层传送器无视楼梯 ----------
    // 引擎在 events.js / control.js / fly 道具 canUseItemEffect 中统一读取
    // core.flags.flyNearStair 判定"必须在楼梯边"，强制置 false 即可放开；
    // 读档/重开会重新套用 data.js 的值，用轮询持续兜底。
    setInterval(function () {
        const core = W.core;
        if (state.flyFree && core && core.flags && core.flags.flyNearStair)
            core.flags.flyNearStair = false;
    }, 500);

    // ---------- 功能三：回春触发计算 ----------
    // 回春系特技（46回春 / 85/86/88/89各级回春术 / 90生命永恒）：战斗总伤害为0时，
    // 战后勇士回血（勇士攻防和的N倍）。这里反推"还需要多少攻/防/护盾才能让战斗伤害归零"。
    // 做法：直接调用塔自身的 core.enemys.getDamageInfo，传入模拟勇士属性做二分搜索，
    // 因此光环、支援、装备、技能、仇恨等修正与实战完全一致；传入的覆盖对象只写
    // 需要模拟的键，引擎对其余属性自动回落到勇士真实值（与塔内临界计算同一套路）。
    const CS_SPECIALS = [46, 85, 86, 88, 89, 90];
    const CS_TIER = { 46: '回春', 85: '初阶回春', 86: '高阶回春', 88: '仙级回春', 89: '神级回春', 90: '生命永恒' };
    var elCsList = null;
    var csCache = { key: null, at: 0, html: null };

    function trimZero(s) { return s.replace(/\.?0+$/, ''); }
    function fmtNum(n) {
        if (typeof n !== 'number' || !isFinite(n)) return '-';
        n = Math.round(n);
        if (n >= 1e8) return trimZero((n / 1e8).toFixed(2)) + '亿';
        if (n >= 1e4) return trimZero((n / 1e4).toFixed(1)) + '万';
        return String(n);
    }
    function csEscape(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    // 模拟战斗：override 指定要覆盖的勇士属性；返回 null=当前无法战斗，NaN=计算异常
    function csDamageOf(core, enemy, x, y, override) {
        try {
            const info = core.enemys.getDamageInfo(enemy, override || null, x, y);
            return info == null ? null : info.damage;
        } catch (e) { return NaN; }
    }
    // 在[lo,hi]内二分查找最小的x使pred(x)为真（要求pred(hi)已为真）；找不到返回null。
    // 伤害公式对个别特技（反击/破甲）不严格单调，此时结果是"一个可行点"而非严格最小值
    function csBisectMin(lo, hi, pred) {
        if (!(hi > lo) || !pred(hi)) return null;
        while (hi - lo > 1) {
            const mid = Math.floor((lo + hi) / 2);
            if (pred(mid)) hi = mid; else lo = mid;
        }
        return hi;
    }
    // 属性成长比例（攻:防:盾 ≈ 2:2:3，"基准值"=属性值÷对应权重），可按塔内养成习惯调整
    const CS_RATIO = { atk: 2, def: 2, mdef: 3 };
    // 按比例线的回春方案：假设攻防盾保持权重×k 同步提升，从基准值锚点 k0 起二分找最小触发点
    // kt；换算成"从当前实际属性出发各需加多少"（先补齐与比例线的欠账，再按 2Δk/2Δk/3Δk 提升；
    // 已超出比例线的属性记 0），并实际校验该组合确实触发，校验失败则不展示该方案
    function csRatioPlan(core, enemy, x, y, k0, cur, atk0, def0, mdef0, mon) {
        const lo = Math.ceil(k0);
        const hi = lo + Math.ceil(mon.hp + mon.atk + mon.def + (cur > 0 ? cur : 0)) + 1000;
        const lineV = function (k) {
            return csDamageOf(core, enemy, x, y, {
                atk: CS_RATIO.atk * k, def: CS_RATIO.def * k, mdef: CS_RATIO.mdef * k
            });
        };
        let kt;
        const vLo = lineV(lo);
        if (vLo != null && vLo <= 0) kt = lo; // 锚点处已触发（常见于强势属性做锚点，只剩补欠账）
        else kt = csBisectMin(lo, hi, function (k) { const v = lineV(k); return v != null && v <= 0; });
        if (kt == null) return null;
        const inc = {
            atk: Math.max(0, CS_RATIO.atk * kt - atk0),
            def: Math.max(0, CS_RATIO.def * kt - def0),
            mdef: Math.max(0, CS_RATIO.mdef * kt - mdef0),
        };
        const v = csDamageOf(core, enemy, x, y, {
            atk: atk0 + inc.atk, def: def0 + inc.def, mdef: mdef0 + inc.mdef
        });
        if (v == null || v > 0) return null;
        return { kt: kt, dk: kt - lo, inc: inc };
    }
    // 计算单个怪物触发回春还差的属性（单项路径部分）
    function csCalcMonsterBase(core, enemy, x, y) {
        const hero = core.status.hero;
        const atk0 = Math.max(0, Math.floor(hero.atk) || 0);
        const def0 = Math.max(0, Math.floor(hero.def) || 0);
        const mdef0 = Math.max(0, Math.floor(hero.mdef) || 0);
        let mon = null;
        try { mon = core.enemys.getEnemyInfo(enemy, null, x, y); } catch (e) { /* ignore */ }
        if (!mon || !isFinite(mon.hp) || !isFinite(mon.atk)) return { state: 'err' };
        const cur = csDamageOf(core, enemy, x, y, null);
        // 搜索上界：攻按"1回合内击杀"估，防按"压到怪攻"估；另外固伤/仇恨在回春之后结算，
        // 还可靠放大回血量(攻防和)凑平，因此上界再并上当前伤害量级（每加1点属性至少减1点净伤）
        const hiAtk = atk0 + Math.ceil(Math.max(mon.hp + mon.def + 10, cur > 0 ? cur : 0) * 2) + 99;
        const hiDef = def0 + Math.ceil(Math.max(mon.atk * 1.5, cur > 0 ? cur : 0) * 1.2) + 10;
        if (cur == null) {
            // 当前无法战斗（未破防/无敌无十字架等）：先找能破防的攻击，若顺势触发则单加攻即可，
            // 否则给出"破防攻击 + 补防/盾"的组合
            const ab = csBisectMin(atk0, hiAtk, function (a) {
                return csDamageOf(core, enemy, x, y, { atk: a }) != null;
            });
            if (ab == null) return { state: 'nobreak' };
            const dab = csDamageOf(core, enemy, x, y, { atk: ab });
            if (dab != null && dab <= 0)
                return { state: 'paths', cur: null, paths: [{ label: '攻', gap: ab - atk0, to: ab }] };
            const d2 = csBisectMin(def0, hiDef, function (d) {
                const v = csDamageOf(core, enemy, x, y, { atk: ab, def: d });
                return v != null && v <= 0;
            });
            if (d2 != null)
                return { state: 'mix', mix: [['攻', ab - atk0, ab], ['防', d2 - def0, d2]] };
            const hiMdef = mdef0 + Math.ceil(dab || 0) + 1000;
            const m2 = csBisectMin(mdef0, hiMdef, function (m) {
                const v = csDamageOf(core, enemy, x, y, { atk: ab, mdef: m });
                return v != null && v <= 0;
            });
            if (m2 != null)
                return { state: 'mix', mix: [['攻', ab - atk0, ab], ['盾', m2 - mdef0, m2]] };
            return { state: 'none', cur: dab };
        }
        if (typeof cur !== 'number') return { state: 'err' };
        if (cur <= 0) return { state: 'ok', heal: -cur };
        // 已能战斗但未触发：分别求"仅加攻/仅加防/仅加盾"到伤害归零的最小增量
        const paths = [];
        const a1 = csBisectMin(atk0, hiAtk, function (a) {
            const v = csDamageOf(core, enemy, x, y, { atk: a });
            return v != null && v <= 0;
        });
        if (a1 != null) paths.push({ label: '攻', gap: a1 - atk0, to: a1 });
        const d1 = csBisectMin(def0, hiDef, function (d) {
            const v = csDamageOf(core, enemy, x, y, { def: d });
            return v != null && v <= 0;
        });
        if (d1 != null) paths.push({ label: '防', gap: d1 - def0, to: d1 });
        const hiMdef = mdef0 + Math.ceil(cur) + 1000;
        const m1 = csBisectMin(mdef0, hiMdef, function (m) {
            const v = csDamageOf(core, enemy, x, y, { mdef: m });
            return v != null && v <= 0;
        });
        if (m1 != null) paths.push({ label: '盾', gap: m1 - mdef0, to: m1 });
        if (!paths.length) return { state: 'none', cur: cur };
        paths.sort(function (p, q) { return p.gap - q.gap; });
        return { state: 'paths', cur: cur, paths: paths };
    }
    // 在单项路径结果之上，附加"按2:2:3比例同步提升"的两个锚点方案
    function csCalcMonster(core, enemy, x, y) {
        const res = csCalcMonsterBase(core, enemy, x, y);
        if (res.state === 'ok' || res.state === 'err') return res;
        try {
            const hero = core.status.hero;
            const atk0 = Math.max(0, Math.floor(hero.atk) || 0);
            const def0 = Math.max(0, Math.floor(hero.def) || 0);
            const mdef0 = Math.max(0, Math.floor(hero.mdef) || 0);
            const mon = core.enemys.getEnemyInfo(enemy, null, x, y);
            if (mon && isFinite(mon.hp) && isFinite(mon.atk)) {
                const cur = res.cur > 0 ? res.cur : 0;
                const kAtk = atk0 / CS_RATIO.atk, kDef = def0 / CS_RATIO.def, kMdef = mdef0 / CS_RATIO.mdef;
                const kMax = Math.max(kAtk, kDef, kMdef), kMin = Math.min(kAtk, kDef, kMdef);
                const high = csRatioPlan(core, enemy, x, y, kMax, cur, atk0, def0, mdef0, mon);
                const low = kMax === kMin ? high :
                    csRatioPlan(core, enemy, x, y, kMin, cur, atk0, def0, mdef0, mon);
                if (high || low) res.ratio = { kMax: kMax, kMin: kMin, high: high, low: low };
            }
        } catch (e) { /* 比例方案计算失败不影响单项路径显示 */ }
        return res;
    }
    function csRowHtml(row) {
        const res = row.res;
        let cls = 'mtb-cs-bad', verdict = '', tip = row.name + '［' + row.tier + '］';
        if (res.state === 'ok') {
            cls = 'mtb-cs-ok';
            verdict = '✓已可触发' + (res.heal > 0 ? ' 回血' + fmtNum(res.heal) : '');
        } else if (res.state === 'paths') {
            cls = 'mtb-cs-gap';
            verdict = res.paths.slice(0, 2).map(function (p) { return p.label + '+' + fmtNum(p.gap); }).join(' 或 ');
            tip += '；当前伤害' + fmtNum(res.cur) +
                '；' + res.paths.map(function (p) { return p.label + '达到' + fmtNum(p.to); }).join('，');
        } else if (res.state === 'mix') {
            cls = 'mtb-cs-mix';
            verdict = res.mix.map(function (m) { return m[0] + '+' + fmtNum(m[1]); }).join(' 且 ');
            tip += '；需同时' + res.mix.map(function (m) { return m[0] + '达到' + fmtNum(m[2]); }).join('、');
        } else if (res.state === 'nobreak') {
            verdict = '无法战斗';
        } else if (res.state === 'none') {
            verdict = '无法触发';
            tip += '；当前伤害' + fmtNum(res.cur) + '；提高单项属性无法归零（先攻/魔爆/固伤等）';
        }
        let html = '<div class="mtb-cs-row" title="' + csEscape(tip) + '"><div>' +
            csEscape(row.name + (row.count > 1 ? '×' + row.count : '')) +
            (row.tier ? ' <span class="mtb-cs-tier">' + csEscape(row.tier) + '</span>' : '') +
            '</div><div class="' + cls + '">' + csEscape(verdict) + '</div>';
        if (res.ratio) {
            const R = res.ratio;
            tip += '；基准值=攻÷2、防÷2、盾÷3（当前最高' + fmtNum(R.kMax) + '，最低' + fmtNum(R.kMin) +
                '）；比例方案为沿攻2:防2:盾3的同步提升线到触发点的折算，含补齐欠账，已实际校验';
            const fmtPlan = function (tag, plan) {
                if (!plan) return '';
                const parts = [];
                if (plan.inc.atk > 0) parts.push('攻+' + fmtNum(plan.inc.atk));
                if (plan.inc.def > 0) parts.push('防+' + fmtNum(plan.inc.def));
                if (plan.inc.mdef > 0) parts.push('盾+' + fmtNum(plan.inc.mdef));
                return parts.length ? '<div class="mtb-cs-ratio">2:2:3 ' + tag +
                    '+' + fmtNum(plan.dk) + '基准: ' + parts.join(' ') + '</div>' : '';
            };
            if (R.kMax === R.kMin) html += fmtPlan('', R.high);
            else { html += fmtPlan('高', R.high); html += fmtPlan('低', R.low); }
        }
        return html + '</div>';
    }
    setInterval(function () {
        if (!state.csEnabled || !elCsList) return;
        const core = W.core;
        if (!core || !core.status || !core.status.hero || !core.enemys ||
            typeof core.enemys.getDamageInfo !== 'function' ||
            typeof core.getFlag !== 'function' || typeof core.hasSpecial !== 'function' ||
            (W.main && W.main.replayChecking) ||
            (typeof core.getFlag === 'function' && core.getFlag('__statistics__'))) return;
        const hero = core.status.hero;
        const floorId = core.status.floorId;
        const floor = (core.status.maps && core.status.maps[floorId]) || core.status.thisMaps;
        const blocks = (floor && floor.blocks) || [];
        // 收集本层回春系怪物
        const found = [];
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            if (b.disable || !b.event) continue;
            if (b.event.cls !== 'enemys' && b.event.cls !== 'enemy48') continue;
            for (let j = 0; j < CS_SPECIALS.length; j++) {
                if (core.hasSpecial(b.event.id, CS_SPECIALS[j])) { found.push([b.x, b.y, b.event.id]); break; }
            }
        }
        // 采样签名：勇士属性/装备/关键flag或道具/怪物分布 任一变化才重算（另每10秒兜底刷新）
        const sig = [floorId, hero.atk, hero.def, hero.mdef, hero.hp,
            (hero.equipment || []).join(','), core.getFlag('skill', 0), core.getFlag('hatred', 0),
            core.getFlag('poisonNumber', 0), core.hasItem('cross'), core.hasItem('I529'), core.hasItem('I340'),
            core.itemCount('yellowKey'), core.itemCount('blueKey'), core.itemCount('redKey')]
            .concat(found.map(function (f) { return f.join('_'); })).join('|');
        const now = Date.now();
        if (sig === csCache.key && now - csCache.at < 10000) return;
        csCache.key = sig;
        csCache.at = now;

        const rows = {}, order = [];
        found.forEach(function (f) {
            const enemy = core.material.enemys[f[2]];
            if (!enemy) return;
            let res;
            try { res = csCalcMonster(core, enemy, f[0], f[1]); } catch (e) { res = { state: 'err' }; }
            let tier = '';
            for (let j = 0; j < CS_SPECIALS.length; j++)
                if (core.hasSpecial(f[2], CS_SPECIALS[j])) { tier = CS_TIER[CS_SPECIALS[j]]; break; }
            const key = f[2] + '|' + res.state + '|' + (res.heal || 0) + '|' +
                (res.paths || []).map(function (p) { return p.label + p.gap; }).join(',') + '|' +
                (res.mix || []).map(function (m) { return m[0] + m[1]; }).join(',');
            if (rows[key]) { rows[key].count++; return; }
            const row = { name: enemy.name || f[2], tier: tier, res: res, count: 1 };
            rows[key] = row;
            order.push(row);
        });
        const rank = { ok: 0, paths: 1, mix: 2, none: 3, nobreak: 3, err: 4 };
        order.sort(function (r1, r2) {
            const k1 = rank[r1.res.state], k2 = rank[r2.res.state];
            if (k1 !== k2) return k1 - k2;
            if (r1.res.state === 'paths') return r1.res.paths[0].gap - r2.res.paths[0].gap;
            return 0;
        });
        let html = order.length ? '' : '<div class="mtb-cs-row mtb-cs-bad">本层没有回春系怪物</div>';
        order.forEach(function (row) { html += csRowHtml(row); });
        if (html !== csCache.html) { csCache.html = html; elCsList.innerHTML = html; }
    }, 500);

    // ---------- 功能四：楼层敌人统计 ----------
    // 统计两个选中楼层之间（按 core.floorIds 顺序、含两端）剩余的敌人数量，
    // 以及其中战斗伤害≤0（0伤害或击败回血）的数量。
    // 楼层选择：停留在某楼层后点「设起点/设终点」记录当前楼层；所选楼层找不到时
    // （换玩其他魔塔、切大地图等）或未选择（默认）时，该端按当前楼层处理。
    // 伤害计算复用塔自身公式：当前楼层按怪物坐标精确算（光环/支援生效），
    // 其他楼层按整层算（全局光环生效，坐标类光环/支援不参与），与手册口径一致。
    var elFlr = null;
    var flrCache = { key: null, at: 0, html: null };
    var selState = { a: load(KEY.selA, null), b: load(KEY.selB, null) };

    function flrValid(core, fid) {
        return typeof fid === 'string' && !!(core.floorIds && core.floorIds.indexOf(fid) >= 0);
    }
    // 端点解析：所选楼层不存在（其他魔塔/大地图等）或未选择时，按当前楼层处理
    function flrResolve(core, fid) { return flrValid(core, fid) ? fid : core.status.floorId; }
    function flrTitle(core, fid) {
        let f = null;
        try { f = (core.floors || {})[fid] || (core.status.maps || {})[fid] || null; } catch (e) { /* ignore */ }
        return (f && (f.title || f.name)) || fid;
    }
    // 统计 floors（floorId 数组，含两端）内全部楼层的敌人情况
    function flrStatsCalc(core, floors) {
        const cur = core.status.floorId;
        let total = 0, zero = 0, heal = 0, unfight = 0;
        const perFloor = [];
        floors.forEach(function (fid) {
            try { core.extractBlocks(fid); } catch (e) { /* ignore */ }
            const blocks = ((core.status.maps || {})[fid] || {}).blocks || [];
            let ft = 0, fz = 0, fh = 0, fu = 0;
            for (let i = 0; i < blocks.length; i++) {
                const blk = blocks[i];
                if (blk.disable || !blk.event) continue;
                const cls = blk.event.cls;
                if (cls !== 'enemys' && cls !== 'enemy48') continue;
                const enemy = core.material.enemys[blk.event.id];
                if (!enemy) continue;
                ft++;
                let info;
                try {
                    info = core.enemys.getDamageInfo(enemy, null,
                        fid === cur ? blk.x : null, fid === cur ? blk.y : null, fid);
                } catch (e) { info = undefined; }
                if (info == null) { fu++; continue; } // 不可战斗（未破防/无敌等）
                if (typeof info.damage !== 'number' || !isFinite(info.damage)) continue;
                if (info.damage <= 0) {
                    fz++;
                    if (info.damage < 0) fh++; // 负伤害=击败回血
                }
            }
            total += ft; zero += fz; heal += fh; unfight += fu;
            if (ft > 0) perFloor.push(flrTitle(core, fid) + ' ' + ft + '只' +
                (fz ? '·无损' + fz : '') + (fh ? '·回血' + fh : ''));
        });
        return { total: total, zero: zero, heal: heal, unfight: unfight, perFloor: perFloor };
    }
    setInterval(function () {
        if (!elFlr) return;
        const core = W.core;
        if (!core || !core.status || !core.status.hero || !core.enemys || !core.floorIds ||
            typeof core.enemys.getDamageInfo !== 'function' ||
            (W.main && W.main.replayChecking) ||
            (typeof core.getFlag === 'function' && core.getFlag('__statistics__'))) return;
        const hero = core.status.hero, cur = core.status.floorId;
        // 端点解析：找不到/未选择 → 当前楼层
        const a = flrResolve(core, selState.a);
        const b = flrResolve(core, selState.b);
        const ids = core.floorIds;
        const i1 = ids.indexOf(a), i2 = ids.indexOf(b);
        if (i1 < 0 || i2 < 0) return;
        const floors = ids.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
        // 变化检测：端点/勇士属性/装备/关键flag/范围内敌人分布 任一变化才重算（另每10秒兜底）
        const sig = [cur, selState.a, selState.b, hero.atk, hero.def, hero.mdef, hero.hp,
            (hero.equipment || []).join(','), core.getFlag('skill', 0), core.getFlag('hatred', 0),
            core.getFlag('poisonNumber', 0), core.hasItem('cross')];
        floors.forEach(function (fid) {
            try { core.extractBlocks(fid); } catch (e) { /* ignore */ }
            const blocks = ((core.status.maps || {})[fid] || {}).blocks || [];
            const part = [fid];
            for (let i = 0; i < blocks.length; i++) {
                const bl = blocks[i];
                if (bl.disable || !bl.event) continue;
                const cls = bl.event.cls;
                if (cls === 'enemys' || cls === 'enemy48') part.push(bl.x + ',' + bl.y + ',' + bl.event.id);
            }
            sig.push(part.join('#'));
        });
        const now = Date.now();
        const sigStr = sig.join('||');
        if (sigStr === flrCache.key && now - flrCache.at < 10000) return;
        flrCache.key = sigStr;
        flrCache.at = now;

        const st = flrStatsCalc(core, floors);
        const selText = function (fid) {
            const t = flrTitle(core, fid);
            return fid === cur ? '当前(' + t + ')' : t;
        };
        let html = '<div class="mtb-flr-sel">起点: ' + csEscape(selText(a)) +
            ' · 终点: ' + csEscape(selText(b)) + '</div>';
        let stat = csEscape(a === b ? flrTitle(core, a) : flrTitle(core, a) + '~' + flrTitle(core, b)) +
            '：敌人 <b>' + st.total + '</b> 只';
        if (st.unfight > 0) stat += ' · 不可战斗 ' + st.unfight;
        html += '<div class="mtb-flr-stat">' + stat + '</div>';
        html += '<div class="mtb-flr-stat' + (st.zero > 0 ? ' mtb-flr-ok' : '') + '">零伤/回血 <b>' +
            st.zero + '</b> 只' + (st.heal > 0 ? '（回血 ' + st.heal + '）' : '') + '</div>';
        if (st.perFloor.length > 1)
            html += '<div class="mtb-flr-detail">' + csEscape(st.perFloor.join('；')) + '</div>';
        if (html !== flrCache.html) { flrCache.html = html; elFlr.innerHTML = html; }
    }, 600);

    // ---------- 功能五：扣血转加血（目前仅处理战斗扣血） ----------
    // 打开后，战斗对勇士造成的伤害翻转为等量加血（原本就加血的一律不动）：
    //  1) 包装 getDamageInfo：仅战斗期间的最外层调用把正伤害翻转为负，
    //     战斗内的致死判定（damage >= hp）随之失效，原本打死的战斗也变成加血；
    //  2) 包装战斗入口：设置"战斗中"标记供上者生效，战后把残余的净扣血
    //    （如败移等特殊分支）补翻转。
    // 回放校验与统计模式下不生效。地图伤害（领域/中毒等）、事件、道具暂不处理。
    var flipDepth = 0;
    var flipInBattle = false;

    function flipGuarded(core) {
        return state.hpFlip && !(W.main && W.main.replayChecking) &&
            !(typeof core.getFlag === 'function' && core.getFlag('__statistics__'));
    }
    function flipMark(fn, base) { fn.__mtbFlip = true; fn.__mtbFlipBase = base; return fn; }

    function flipDamageWrap(original) {
        const fn = function () {
            const active = flipInBattle && flipGuarded(W.core);
            flipDepth++;
            let ret;
            try { ret = original.apply(this, arguments); }
            finally { flipDepth--; }
            if (active && flipDepth === 0 && ret && typeof ret === 'object' &&
                typeof ret.damage === 'number' && ret.damage > 0) {
                ret.damage = -ret.damage;
            }
            return ret;
        };
        return flipMark(fn, original);
    }
    function flipBattleWrap(original) {
        const fn = function () {
            const core = W.core;
            if (!flipGuarded(core)) return original.apply(this, arguments);
            const before = core.status && core.status.hero ? core.status.hero.hp : null;
            flipInBattle = true;
            try { return original.apply(this, arguments); }
            finally {
                flipInBattle = false;
                // 兜底：战斗内其他分支（如败移）造成的残余净扣血也补翻转
                if (before != null && core.status && core.status.hero) {
                    const after = core.status.hero.hp;
                    if (after < before) {
                        core.status.hero.hp = before + (before - after);
                        try { core.updateStatusBar(false, true); } catch (e) { /* ignore */ }
                    }
                }
            }
        };
        return flipMark(fn, original);
    }
    // 看门狗：引擎函数可能被塔/插件重新赋值，持续对账补包（标记防重复包装；
    // core.getDamageInfo 是转发别名，三处都包时靠深度计数保证只翻转一次）
    function syncFlipHook() {
        const core = W.core;
        if (!core) return;
        if (W.enemys && W.enemys.prototype && typeof W.enemys.prototype.getDamageInfo === 'function' &&
            !W.enemys.prototype.getDamageInfo.__mtbFlip)
            W.enemys.prototype.getDamageInfo = flipDamageWrap(W.enemys.prototype.getDamageInfo);
        if (core.enemys && Object.prototype.hasOwnProperty.call(core.enemys, 'getDamageInfo') &&
            !core.enemys.getDamageInfo.__mtbFlip)
            core.enemys.getDamageInfo = flipDamageWrap(core.enemys.getDamageInfo);
        if (Object.prototype.hasOwnProperty.call(core, 'getDamageInfo') && !core.getDamageInfo.__mtbFlip)
            core.getDamageInfo = flipDamageWrap(core.getDamageInfo);
        if (W.events && W.events.prototype && typeof W.events.prototype.battle === 'function' &&
            !W.events.prototype.battle.__mtbFlip)
            W.events.prototype.battle = flipBattleWrap(W.events.prototype.battle);
        if (core.events && Object.prototype.hasOwnProperty.call(core.events, 'battle') &&
            !core.events.battle.__mtbFlip)
            core.events.battle = flipBattleWrap(core.events.battle);
    }
    setInterval(syncFlipHook, 300);

    // ---------- 功能六：撤销悬浮按钮 ----------
    // 复刻键盘 A 键「读取自动存档（回退）」：core.doSL('autoSave','load')，供鼠标/触摸使用。
    // 按住可拖动位置并记忆；移动距离小于阈值视为点击。仅游戏中且无事件页面时生效。
    const UNDO_ID = 'mota-toolbox-undo';
    if (!document.getElementById(UNDO_ID)) {
        const undoBtn = document.createElement('div');
        undoBtn.id = UNDO_ID;
        undoBtn.title = '回退到上一个节点（同键盘A键）';
        undoBtn.textContent = '↩';
        undoBtn.style.display = 'none'; // 由轮询决定显示（标题界面不显示）
        document.body.appendChild(undoBtn);
        const savedUndo = load(KEY.undoPos, null);
        if (savedUndo) {
            undoBtn.style.left = savedUndo.x + 'px';
            undoBtn.style.top = savedUndo.y + 'px';
        } else {
            undoBtn.style.right = '18px';
            undoBtn.style.bottom = '18px';
        }
        let press = null;
        undoBtn.addEventListener('pointerdown', function (e) {
            press = { x: e.clientX, y: e.clientY, moved: false };
            try { undoBtn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            e.preventDefault();
        });
        undoBtn.addEventListener('pointermove', function (e) {
            if (!press) return;
            if (!press.moved && Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) <= 6) return;
            press.moved = true;
            undoBtn.style.right = 'auto';
            undoBtn.style.bottom = 'auto';
            undoBtn.style.left = Math.max(0, e.clientX - undoBtn.offsetWidth / 2) + 'px';
            undoBtn.style.top = Math.max(0, e.clientY - undoBtn.offsetHeight / 2) + 'px';
        });
        undoBtn.addEventListener('pointercancel', function () { press = null; });
        undoBtn.addEventListener('pointerup', function () {
            const moved = press && press.moved;
            press = null;
            if (moved) {
                save(KEY.undoPos, { x: undoBtn.offsetLeft, y: undoBtn.offsetTop });
                return;
            }
            const core = W.core;
            if (!core || typeof core.doSL !== 'function' || !core.isPlaying || !core.isPlaying()) return;
            if (W.main && W.main.replayChecking) return;
            if (core.status.event && core.status.event.id) return; // 事件/页面打开时不响应（与A键一致）
            try { core.doSL('autoSave', 'load'); } catch (err) { /* ignore */ }
        });
        // 标题界面隐藏
        setInterval(function () {
            const core = W.core;
            const show = !!(core && core.isPlaying && core.isPlaying() &&
                !(W.main && W.main.replayChecking));
            undoBtn.style.display = show ? '' : 'none';
        }, 500);
    }

    // ---------- 功能七：楼传页面滚动条 ----------
    // 楼层传送页面打开时，在其下方显示一个滑条。滑条只代表"当前状态下能到达的楼层"
    // （与塔的 flyTo 判定完全一致：当前层可出发 canFlyFrom + 目标层可到达 canFlyTo +
    // 已到访），一格对应一个可达楼层，未到访/不可达楼层不占位置。
    // 拖动 → 可达列表第 N 项 → core.ui.drawFly(其在 floorIds 中的下标) 重绘；
    // 键盘/点击换层时滑块自动跟随；可达层不足 2 个时隐藏滑条。
    function flyReachable(core) {
        const out = [];
        try {
            const ids = core.floorIds || [];
            const from = core.status.floorId;
            if (!(core.status.maps[from] || {}).canFlyFrom) return out;
            for (let i = 0; i < ids.length; i++) {
                const info = core.status.maps[ids[i]];
                if (!info || !info.canFlyTo) continue;
                if (!core.hasVisitedFloor(ids[i])) continue;
                out.push(ids[i]);
            }
        } catch (e) { /* ignore */ }
        return out;
    }
    function flySelect(core, pos) {
        const ev = core.status.event;
        if (!ev || ev.id !== 'fly') return false;
        const fid = flyReachable(core)[pos];
        if (!fid) return false;
        const target = core.floorIds.indexOf(fid);
        if (target === ev.data) return false;
        try { core.ui.drawFly(target); } catch (e) { return false; }
        return true;
    }
    const FLY_ID = 'mota-toolbox-flybar';
    if (!document.getElementById(FLY_ID)) {
        const flyBar = document.createElement('div');
        flyBar.id = FLY_ID;
        flyBar.innerHTML = '<input type="range" min="0" max="1" step="1" value="0">';
        flyBar.style.display = 'none';
        document.body.appendChild(flyBar);
        const range = flyBar.querySelector('input');
        let lastUser = 0, wasOpen = false;
        const markUser = function () { lastUser = Date.now(); };
        range.addEventListener('pointerdown', markUser);
        range.addEventListener('input', function () {
            markUser();
            const core = W.core;
            if (!core || !core.status || !core.status.event) return;
            flySelect(core, +range.value);
        });
        window.addEventListener('pointerup', function () {
            // 拖动结束立即把滑块对齐到实际选中的楼层
            const core = W.core;
            if (core && core.status && core.status.event && core.status.event.id === 'fly') {
                const pos = flyReachable(core).indexOf(core.floorIds[core.status.event.data]);
                if (pos >= 0) range.value = pos;
            }
        });
        setInterval(function () {
            const core = W.core;
            const ev = core && core.status && core.status.event;
            const open = !!(core && core.floorIds && ev && ev.id === 'fly');
            const list = open ? flyReachable(core) : [];
            const show = open && list.length >= 2;
            if (show && !wasOpen) lastUser = 0;
            wasOpen = show;
            flyBar.style.display = show ? '' : 'none';
            if (!show) return;
            if (+range.max !== list.length - 1) range.max = list.length - 1;
            const pos = list.indexOf(core.floorIds[ev.data]);
            // 仅在用户最近没有操作滑条时回写位置，避免和拖动打架
            if (Date.now() - lastUser > 400 && pos >= 0 && +range.value !== pos) {
                range.value = pos;
            }
            // 贴着游戏画布下缘放置；窗口放不下时贴住窗口底部。
            // 注意 core.canvas.ui 是 2D 上下文，画布元素在 .canvas 上
            let positioned = false;
            try {
                const el = core.canvas && core.canvas.ui && core.canvas.ui.canvas;
                if (el && el.getBoundingClientRect) {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0) {
                        flyBar.style.left = (r.left + r.width / 2) + 'px';
                        flyBar.style.top = Math.min(r.bottom + 4, window.innerHeight - 44) + 'px';
                        flyBar.style.width = Math.min(420, Math.max(240, r.width * 0.8)) + 'px';
                        positioned = true;
                    }
                }
            } catch (e) { /* ignore */ }
            if (!positioned) {
                flyBar.style.left = window.innerWidth / 2 + 'px';
                flyBar.style.top = (window.innerHeight - 48) + 'px';
            }
        }, 300);
    }

    // ---------- 面板 ----------
    const PANEL_ID = 'mota-toolbox-panel';
    if (document.getElementById(PANEL_ID)) return;

    const css = `
#${PANEL_ID} { position:fixed; z-index:2147483000; font:12px/1.6 Consolas,Menlo,monospace;
    background:rgba(20,22,28,.92); color:#dfe3ea; border:1px solid #4a5060; border-radius:8px;
    width:224px; user-select:none; box-shadow:0 4px 16px rgba(0,0,0,.5); }
#${PANEL_ID} .mtb-head { padding:5px 8px; cursor:move; border-bottom:1px solid #3a4050;
    display:flex; justify-content:space-between; align-items:center; }
#${PANEL_ID} .mtb-title { font-weight:bold; color:#ff9a9a; }
#${PANEL_ID} .mtb-min { cursor:pointer; padding:0 5px; color:#8a93a5; }
#${PANEL_ID} .mtb-body { padding:8px; }
#${PANEL_ID}.collapsed .mtb-body { display:none; }
#${PANEL_ID} label.mtb-ck { display:flex; align-items:center; gap:5px; margin-bottom:6px; cursor:pointer; }
#${PANEL_ID} .mtb-row { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
#${PANEL_ID} input[type=number] { width:52px; background:#14161c; color:#fff; border:1px solid #4a5060;
    border-radius:4px; padding:2px 4px; font:inherit; }
#${PANEL_ID} input[type=range] { flex:1; accent-color:#ff6a6a; }
#${PANEL_ID} .mtb-presets { display:flex; gap:4px; margin-bottom:6px; }
#${PANEL_ID} .mtb-presets button { flex:1; background:#2a2f3a; color:#dfe3ea; border:1px solid #4a5060;
    border-radius:4px; cursor:pointer; font:inherit; padding:2px 0; }
#${PANEL_ID} .mtb-presets button:hover { background:#3a4152; }
#${PANEL_ID} .mtb-gain { color:#8a93a5; min-height:18px; }
#${PANEL_ID} .mtb-gain b { color:#7fdc7f; }
#${PANEL_ID} .mtb-sep { border-top:1px solid #3a4050; margin:8px 0; }
#${PANEL_ID} .mtb-cs-list { max-height:240px; overflow-y:auto; }
#${PANEL_ID} .mtb-cs-row { padding:2px 0; border-bottom:1px dashed #2a2f3a; line-height:1.5; }
#${PANEL_ID} .mtb-cs-row:last-child { border-bottom:none; }
#${PANEL_ID} .mtb-cs-tier { color:#8a93a5; }
#${PANEL_ID} .mtb-cs-ok { color:#7fdc7f; }
#${PANEL_ID} .mtb-cs-gap { color:#6ecbff; }
#${PANEL_ID} .mtb-cs-mix { color:#ffc86e; }
#${PANEL_ID} .mtb-cs-ratio { color:#b48cff; }
#${PANEL_ID} .mtb-cs-bad { color:#777f8f; }
#${PANEL_ID} .mtb-flr-sel { color:#8a93a5; }
#${PANEL_ID} .mtb-flr-stat { color:#dfe3ea; }
#${PANEL_ID} .mtb-flr-stat b { color:#ff9a9a; }
#${PANEL_ID} .mtb-flr-stat.mtb-flr-ok, #${PANEL_ID} .mtb-flr-stat.mtb-flr-ok b { color:#7fdc7f; }
#${PANEL_ID} .mtb-flr-detail { color:#777f8f; font-size:11px; }
#mota-toolbox-undo { position:fixed; z-index:2147482995; width:44px; height:44px; border-radius:50%;
    background:rgba(20,22,28,.82); border:1px solid #4a5060; color:#ff9a9a;
    font:bold 20px/42px Consolas,Menlo,monospace; text-align:center; cursor:pointer;
    user-select:none; -webkit-user-select:none; touch-action:none; box-shadow:0 4px 12px rgba(0,0,0,.5); }
#mota-toolbox-undo:active { background:rgba(58,65,82,.95); }
#mota-toolbox-flybar { position:fixed; z-index:2147482995; transform:translateX(-50%);
    padding:5px 12px; background:rgba(20,22,28,.88); border:1px solid #4a5060; border-radius:8px;
    box-shadow:0 4px 12px rgba(0,0,0,.5); touch-action:none; }
#mota-toolbox-flybar input[type=range] { width:100%; accent-color:#ff6a6a; margin:0; display:block; touch-action:none; }
`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
        <div class="mtb-head"><span class="mtb-title">魔塔工具箱</span><span class="mtb-min" title="折叠">—</span></div>
        <div class="mtb-body">
            <label class="mtb-ck"><input type="checkbox" class="mtb-potion-on"> 血瓶倍率</label>
            <div class="mtb-row">
                <input type="number" class="mtb-potion-num" min="0" max="9999" step="0.5">
                <input type="range" class="mtb-potion-slider" min="0.5" max="10" step="0.5">
            </div>
            <div class="mtb-presets">
                <button data-v="1">×1</button><button data-v="2">×2</button>
                <button data-v="5">×5</button><button data-v="10">×10</button>
                <button data-v="50">×50</button>
            </div>
            <div class="mtb-gain">本次实际加血: <b class="mtb-gainv">-</b></div>
            <div class="mtb-sep"></div>
            <label class="mtb-ck"><input type="checkbox" class="mtb-fly-free"> 楼传无视楼梯限制</label>
            <label class="mtb-ck"><input type="checkbox" class="mtb-flip-on" title="战斗造成的伤害翻转为等量加血"> 扣血转加血</label>
            <div class="mtb-sep"></div>
            <label class="mtb-ck"><input type="checkbox" class="mtb-cs-on"> 回春触发计算</label>
            <div class="mtb-cs-list"></div>
            <div class="mtb-sep"></div>
            <div class="mtb-ck">楼层敌人统计</div>
            <div class="mtb-presets">
                <button class="mtb-sel-a" title="把当前停留的楼层设为起点">设起点</button>
                <button class="mtb-sel-b" title="把当前停留的楼层设为终点">设终点</button>
                <button class="mtb-sel-x" title="清除选择（两端恢复为当前楼层）">✕</button>
            </div>
            <div class="mtb-flr"></div>
        </div>`;
    document.body.appendChild(panel);

    const elOn = panel.querySelector('.mtb-potion-on');
    const elNum = panel.querySelector('.mtb-potion-num');
    const elSlider = panel.querySelector('.mtb-potion-slider');
    const elGain = panel.querySelector('.mtb-gainv');
    const elFly = panel.querySelector('.mtb-fly-free');
    const elFlip = panel.querySelector('.mtb-flip-on');
    const elCs = panel.querySelector('.mtb-cs-on');
    elCsList = panel.querySelector('.mtb-cs-list');
    elFlr = panel.querySelector('.mtb-flr');

    function render() {
        elOn.checked = state.potionEnabled;
        elNum.value = state.potionMult;
        elSlider.value = Math.min(Math.max(state.potionMult, +elSlider.min), +elSlider.max);
        elFly.checked = state.flyFree;
        elFlip.checked = state.hpFlip;
        elCs.checked = state.csEnabled;
        elCsList.style.display = state.csEnabled ? '' : 'none';
        panel.style.opacity = state.potionEnabled || state.flyFree || state.hpFlip || state.csEnabled ? '1' : '0.55';
    }
    function setMult(v) {
        v = Math.max(0, Math.min(9999, Math.round(v * 2) / 2));
        state.potionMult = v || 1;
        save(KEY.mult, state.potionMult);
        render();
    }
    elOn.addEventListener('change', function () {
        state.potionEnabled = elOn.checked;
        save(KEY.enabled, state.potionEnabled);
        render();
    });
    elNum.addEventListener('change', function () { setMult(parseFloat(elNum.value)); });
    elSlider.addEventListener('input', function () { setMult(parseFloat(elSlider.value)); });
    panel.querySelectorAll('.mtb-presets button').forEach(function (b) {
        b.addEventListener('click', function () { setMult(parseFloat(b.dataset.v)); });
    });
    elFly.addEventListener('change', function () {
        state.flyFree = elFly.checked;
        save(KEY.flyFree, state.flyFree);
        if (state.flyFree && W.core && W.core.flags) W.core.flags.flyNearStair = false;
        render();
    });
    elFlip.addEventListener('change', function () {
        state.hpFlip = elFlip.checked;
        save(KEY.hpFlip, state.hpFlip);
        render();
    });
    elCs.addEventListener('change', function () {
        state.csEnabled = elCs.checked;
        save(KEY.cs, state.csEnabled);
        csCache.key = null; // 开关切换后强制重算
        render();
    });
    panel.querySelector('.mtb-sel-a').addEventListener('click', function () {
        if (W.core && W.core.status) {
            selState.a = W.core.status.floorId;
            save(KEY.selA, selState.a);
            flrCache.key = null;
        }
    });
    panel.querySelector('.mtb-sel-b').addEventListener('click', function () {
        if (W.core && W.core.status) {
            selState.b = W.core.status.floorId;
            save(KEY.selB, selState.b);
            flrCache.key = null;
        }
    });
    panel.querySelector('.mtb-sel-x').addEventListener('click', function () {
        selState.a = null;
        selState.b = null;
        save(KEY.selA, null);
        save(KEY.selB, null);
        flrCache.key = null;
    });

    // 轮询显示本次实际加血量
    let shownGain = -1;
    setInterval(function () {
        if (!state.potionEnabled || state.lastGain === shownGain) return;
        shownGain = state.lastGain;
        elGain.textContent = state.lastGain > 0 ? '+' + state.lastGain : '-';
    }, 300);

    // 折叠
    panel.querySelector('.mtb-min').addEventListener('click', function () {
        panel.classList.toggle('collapsed');
    });

    // 拖动 + 位置记忆
    const savedPos = load(KEY.pos, null);
    if (savedPos) {
        panel.style.left = savedPos.x + 'px';
        panel.style.top = savedPos.y + 'px';
    } else {
        panel.style.right = '12px';
        panel.style.top = '90px';
    }
    (function () {
        const head = panel.querySelector('.mtb-head');
        let drag = null;
        head.addEventListener('pointerdown', function (e) {
            // 按在折叠按钮上时不启动拖动：否则 setPointerCapture 会把 pointerup
            // 重定向到标题栏，click 的目标也随之变成标题栏，按钮收不到点击
            if (e.target.closest('.mtb-min')) return;
            drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
            panel.style.right = 'auto';
            head.setPointerCapture(e.pointerId);
        });
        head.addEventListener('pointermove', function (e) {
            if (!drag) return;
            panel.style.left = Math.max(0, e.clientX - drag.dx) + 'px';
            panel.style.top = Math.max(0, e.clientY - drag.dy) + 'px';
        });
        head.addEventListener('pointerup', function () {
            drag = null;
            save(KEY.pos, { x: panel.offsetLeft, y: panel.offsetTop });
        });
    })();

    render();

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('显示/隐藏魔塔工具箱面板', function () {
            panel.style.display = panel.style.display === 'none' ? '' : 'none';
        });
    }
})();
