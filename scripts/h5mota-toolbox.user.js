// ==UserScript==
// @name         H5魔塔工具箱
// @namespace    hsjje-h5mota-toolbox
// @version      1.1.0
// @description  血瓶拾取/使用倍率 + 楼层传送器无视楼梯限制，适用于 HTML5魔塔引擎（土豆魔塔）游戏
// @author       hsjje
// @match        http://127.0.0.1/*
// @match        http://localhost/*
// @match        https://h5mota.com/*
// @match        file:///*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // 编辑器页面不注入
    if (/editor/i.test(location.pathname)) return;

    const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    // ---------- 持久化 ----------
    const KEY = {
        enabled: 'motaToolbox.potionEnabled',
        mult: 'motaToolbox.potionMult',
        flyFree: 'motaToolbox.flyFree',
        pos: 'motaToolbox.pos'
    };
    // 旧版「血瓶倍率助手」键名，用于读取历史配置
    const LEGACY = { enabled: 'potionMult.enabled', mult: 'potionMult.mult', pos: 'potionMult.pos' };

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
    function loadWithLegacy(k, legacyK, dft) {
        let v = rawLoad(k);
        if (v === undefined) v = rawLoad(legacyK);
        return v === undefined ? dft : v;
    }
    function save(k, v) {
        try {
            const s = JSON.stringify(v);
            if (hasGM) GM_setValue(k, s); else localStorage.setItem(k, s);
        } catch (e) { /* ignore */ }
    }

    const state = {
        potionEnabled: loadWithLegacy(KEY.enabled, LEGACY.enabled, true),
        potionMult: loadWithLegacy(KEY.mult, LEGACY.mult, 2),
        flyFree: load(KEY.flyFree, true),
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
        </div>`;
    document.body.appendChild(panel);

    const elOn = panel.querySelector('.mtb-potion-on');
    const elNum = panel.querySelector('.mtb-potion-num');
    const elSlider = panel.querySelector('.mtb-potion-slider');
    const elGain = panel.querySelector('.mtb-gainv');
    const elFly = panel.querySelector('.mtb-fly-free');

    function render() {
        elOn.checked = state.potionEnabled;
        elNum.value = state.potionMult;
        elSlider.value = Math.min(Math.max(state.potionMult, +elSlider.min), +elSlider.max);
        elFly.checked = state.flyFree;
        panel.style.opacity = state.potionEnabled || state.flyFree ? '1' : '0.55';
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
    const savedPos = loadWithLegacy(KEY.pos, LEGACY.pos, null);
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
