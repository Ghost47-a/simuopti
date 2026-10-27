window.SIMUOPTI_APP = true;
window.SIMUOPTI_LITE = true;
(function () {
  'use strict';

  /* =====================================================================
   *  MOTEUR
   * ===================================================================== */
  const Core = (() => {
    // vie / attaque / défense / coefficient d'XP / peut gagner de l'XP
    const UNITS = {
      JSN: { nom: 'JSN', vie: 8,  att: 3,  def: 2,  xp: 1,          pex: true  },
      SN:  { nom: 'SN',  vie: 10, att: 5,  def: 4,  xp: 1.47058824, pex: true  },
      NE:  { nom: 'NE',  vie: 13, att: 7,  def: 6,  xp: 2,          pex: false },
      JS:  { nom: 'JS',  vie: 16, att: 10, def: 9,  xp: 2.670597,   pex: true  },
      S:   { nom: 'S',   vie: 20, att: 15, def: 14, xp: 3.670585,   pex: true  },
      C:   { nom: 'C',   vie: 30, att: 1,  def: 25, xp: 5.1059,     pex: true  },
      CE:  { nom: 'CE',  vie: 40, att: 1,  def: 35, xp: 6.96475,    pex: false },
      A:   { nom: 'A',   vie: 10, att: 30, def: 15, xp: 3.47055,    pex: true  }, // déf 15 mesurée sur rapport
      AE:  { nom: 'AE',  vie: 12, att: 35, def: 18, xp: 4.1059,     pex: false }, // def 18 mesurée sur rapport
      SE:  { nom: 'SE',  vie: 27, att: 24, def: 23, xp: 5.411766,   pex: false },
      T:   { nom: 'T',   vie: 35, att: 55, def: 1,  xp: 7.55295,    pex: true  },
      TE:  { nom: 'TE',  vie: 50, att: 80, def: 1,  xp: 11.6471,    pex: false },
      Tu:  { nom: 'Tu',  vie: 50, att: 50, def: 50, xp: 10.694125,  pex: true  },
      TuE: { nom: 'TuE', vie: 55, att: 55, def: 55, xp: 11.764725,  pex: false },
    };
    // libellés affichés (codes internes inchangés)
    const LAB = { JSN: 'JSN', SN: 'SN', NE: 'NE', JS: 'JS', S: 'S', C: 'C', CE: 'CE', A: 'A', AE: 'AE', SE: 'SE', T: 'Tk', TE: 'TkE', Tu: 'Tu', TuE: 'TuE' };
    const MAX = 50; // niveau maximum d'un bâtiment ou d'une recherche
    const EVOL = { JSN: 'SN', SN: 'NE', JS: 'S', S: 'SE', C: 'CE', A: 'AE', T: 'TE', Tu: 'TuE' };

    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
      .split(' ').map((w) => w.replace(/s$/, '')).join(' ');
    const NAMES = {
      'jeune soldate naine': 'JSN', 'soldate naine': 'SN', "naine d'elite": 'NE',
      'jeune soldate': 'JS', 'soldate': 'S', "soldate d'elite": 'SE',
      'concierge': 'C', "concierge d'elite": 'CE', 'artilleuse': 'A', "artilleuse d'elite": 'AE',
      'tank': 'T', "tank d'elite": 'TE', 'tueuse': 'Tu', "tueuse d'elite": 'TuE',
    };
    const unitCode = (label) => NAMES[norm(label)] || null;
    const toInt = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;
    const NUM = '[\\d \\u00a0\\u202f]+';

    function parseArmy(text) {
      const army = [];
      const re = new RegExp('(\\d[\\d \\u00a0\\u202f]*)\\s+([^\\d,.;]+)', 'g');
      let m;
      while ((m = re.exec(text))) {
        const code = unitCode(m[2]);
        const n = toInt(m[1]);
        if (code && n > 0) army.push([code, n]);
      }
      return army;
    }

    function parseHeader(line) {
      let m;
      if ((m = line.match(/Vous attaquez (?:la |le |l['’])?(fourmili[eè]re|Loge Imp[ée]riale|terrain de chasse) de (\S+)/i)))
        return { att: null, def: m[2], place: placeOf(m[1]) };
      if ((m = line.match(/(\S+) attaque (?:la |le |l['’])?(fourmili[eè]re|Loge Imp[ée]riale|terrain de chasse) de (\S+)/i)))
        return { att: m[1], def: m[3], place: placeOf(m[2]) };
      if ((m = line.match(/(\S+) attaque une de vos colonies/i)))
        return { att: m[1], def: null, place: 'dome', colonie: true };
      if ((m = line.match(/(\S+) attaque (?:votre|vos) (fourmili[eè]re|Loge Imp[ée]riale|terrain de chasse)/i)))
        return { att: m[1], def: null, place: placeOf(m[2]) };
      if ((m = line.match(/Attaque (?:réussie|échouée|ratée)? ?contre (\S+)/i)))
        return { att: null, def: m[1], place: null, faible: true };
      return null;
    }
    function placeOf(s) {
      s = norm(s);
      if (s.startsWith('loge')) return 'loge';
      if (s.startsWith('fourmili')) return 'dome';
      if (s.startsWith('terrain')) return 'terrain';
      return null;
    }

    /** Découpe un texte en combats. */
    function parseReports(text) {
      const lines = text.split(/\r?\n/);
      const combats = [];
      let header = null, cur = null, dateVue = null;
      const dmgRe = new RegExp('inflige[sz]?\\s+(' + NUM + ')\\(\\+\\s*(' + NUM + ')\\)\\s*d[ée]g[âa]ts.*?\\btue[sz]?\\s+(' + NUM + ')', 'i');
      const xpRe = new RegExp('^\\s*-\\s*(' + NUM + ')\\s+(.+?)\\s+sont devenues des\\s+(.+?)\\s*$', 'i');
      for (const raw of lines) {
        const line = raw.replace(/\[\/?[a-z]+(?:=[^\]]*)?\]/gi, '').trim();
        if (!line) continue;
        const h = parseHeader(line);
        if (h && !/Troupes en/i.test(line)) {
          // une ligne « Attaque réussie contre X » ne doit pas écraser une en-tête plus précise
          if (!(h.faible && header && !header.faible && header.def === h.def)) header = h;
          continue;
        }
        let m;
        // date du rapport (« 24/10/26 à 20h19 »), rattachée au combat qui suit
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\s*(?:à\s*)?\d{1,2}[h:]\d{2}/.test(line)) dateVue = dateRc(line);
        if ((m = line.match(/Troupes en attaque\s*:\s*(.*)$/i))) {
          cur = { header: header || {}, attackers: parseArmy(m[1]), defenders: [], dmg: [], xp: [], date: dateVue };
          combats.push(cur);
          header = null;
          continue;
        }
        if (!cur) continue;
        if ((m = line.match(/Troupes en d[ée]fense\s*:\s*(.*)$/i))) { cur.defenders = parseArmy(m[1]); continue; }
        if ((m = line.match(dmgRe))) { cur.dmg.push({ base: toInt(m[1]), bonus: toInt(m[2]), kills: toInt(m[3]) }); continue; }
        if ((m = line.match(xpRe))) {
          const from = unitCode(m[2]);
          if (from) cur.xp.push({ from, n: toInt(m[1]) });
          continue;
        }
        if (/a gagn[ée] ce combat|Vous avez (gagn|perdu)/i.test(line)) cur.issue = line;
      }
      return combats.filter((c) => c.attackers.length && c.defenders.length && c.dmg.length);
    }

    const sumBy = (army, key) => army.reduce((s, [c, n]) => s + n * UNITS[c][key], 0);
    const count = (army) => army.reduce((s, [, n]) => s + n, 0);

    /** Tue k unités dans l'ordre de l'armée. */
    function killInOrder(army, k) {
      let vie = 0;
      const rest = army.map(([c, n]) => {
        const d = Math.min(n, k);
        k -= d; vie += d * UNITS[c].vie;
        return [c, n - d];
      });
      const next = rest.find(([, n]) => n > 0);
      return { vie, rest, nextVie: next ? UNITS[next[0]].vie : 0 };
    }

    /** Le jeu arrondit les tués à l'unité inférieure : la vie réelle est dans [dmg/(vie+1 unité) ; dmg/vie].
     *  On cale sur la grille des bonus (0,05 pour dôme/loge, 0,1 pour bouclier seul). */
    function snap(dmg, vie, nextVie, grid) {
      const hi = dmg / vie, lo = nextVie ? dmg / (vie + nextVie) : hi;
      const a = Math.ceil(lo / grid - 1e-6), b = Math.floor(hi / grid + 1e-6);
      if (b < a) return { m: hi, sur: false, cands: [] };
      const cands = [];
      for (let g = a; g <= b; g++) cands.push(Math.round(g * grid * 100) / 100);
      // valeur retenue : la plus haute possible (prudent pour planifier, comme Ferdizzz)
      return { m: cands[cands.length - 1], sur: cands.length === 1, cands, lo, hi };
    }
    const FACTEURS = [0.1, 0.3, 0.5, 1];
    const nearInt = (x, tol = 0.02) => Math.abs(x - Math.round(x)) <= tol;
    const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

    /** Analyse d'un combat : armes et vie de chaque camp, tour par tour. */
    function analyseCombat(c) {
      const r = { combat: c, rounds: [], att: { armes: [], vie: [], plafond: [] }, def: { armes: [], vie: [], plafond: [], cands: [] }, warn: [] };
      let A = c.attackers.map((x) => [...x]), D = c.defenders.map((x) => [...x]);
      for (let i = 0; i + 1 < c.dmg.length + 1; i += 2) {
        const da = c.dmg[i], dd = c.dmg[i + 1];
        if (!da) break;
        const round = { n: i / 2 + 1 };
        const totD = count(D), totA = count(A);
        // frappe de l'attaquant
        if (da.base > 0) r.att.armes.push((da.bonus / da.base) * 10);
        const kd = killInOrder(D, da.kills);
        const allD = da.kills >= totD;
        const gridD = (c.header && c.header.place === 'terrain') ? 0.1 : 0.05;
        const sD = kd.vie > 0 && !allD ? snap(da.base + da.bonus, kd.vie, kd.nextVie, gridD) : null;
        const mD = kd.vie > 0 ? (allD ? (da.base + da.bonus) / kd.vie : sD.m) : null;
        if (sD && sD.cands.length) r.def.cands.push(sD.cands);
        round.candsDef = sD ? sD.cands : null;
        if (mD) (allD ? r.def.plafond : r.def.vie).push(mD);
        round.multDef = mD; round.allDef = allD;
        // check de l'attaque de base
        const attCalc = sumBy(A, 'att');
        round.attCheck = attCalc ? da.base / attCalc : null;
        // réplique du défenseur
        if (dd) {
          if (dd.base > 0) r.def.armes.push((dd.bonus / dd.base) * 10);
          const defCalc = sumBy(D, 'def');
          round.defRatio = defCalc ? dd.base / defCalc : null; // ≈1 ou ≈0,1 (one-shot)
          const ka = killInOrder(A, dd.kills);
          const allA = dd.kills >= totA;
          const mA = ka.vie > 0 ? (allA ? (dd.base + dd.bonus) / ka.vie : snap(dd.base + dd.bonus, ka.vie, ka.nextVie, 0.1).m) : null;
          if (mA) (allA ? r.att.plafond : r.att.vie).push(mA);
          round.multAtt = mA; round.allAtt = allA;
          A = ka.rest;
        }
        D = kd.rest;
        r.rounds.push(round);
      }
      r.oneShot = r.rounds.length === 1 && r.rounds[0].allDef;
      const dr = r.rounds[0] && r.rounds[0].defRatio;
      if (dr) {
        r.facteurReplique = FACTEURS.reduce((b, f) => (Math.abs(f - dr) < Math.abs(b - dr) ? f : b), 1);
        if (Math.abs(r.facteurReplique - dr) > 0.02) r.warn.push(`Réplique à ×${dr.toFixed(3)} de la défense : unité inconnue ou stats différentes.`);
        else if (r.oneShot && r.facteurReplique !== 0.1) r.warn.push(`One-shot avec réplique ×${r.facteurReplique} (et non ÷10) : victoire pas assez écrasante.`);
      }
      for (const rd of r.rounds) if (rd.attCheck && Math.abs(rd.attCheck - 1) > 0.002 && rd.n === 1)
        r.warn.push(`Attaque de base ≠ calcul (${(rd.attCheck * 100).toFixed(2)} %) : unité inconnue ou stats différentes.`);
      const lvl = (arr) => { const m = median(arr); return m == null ? null : Math.round(m); };
      r.attArmes = lvl(r.att.armes);
      r.defArmes = lvl(r.def.armes);
      r.attMult = median(r.att.vie);
      r.defMult = median(r.def.vie);
      // valeurs possibles communes à tous les tours
      if (r.def.cands.length) {
        let inter = r.def.cands[0];
        for (const cs of r.def.cands.slice(1)) inter = inter.filter((x) => cs.some((y) => Math.abs(x - y) < 1e-6));
        if (inter.length) { r.defCands = inter; r.defMult = inter[inter.length - 1]; }
      }
      r.defSur = !r.defCands || r.defCands.length <= 1;
      r.defPlafond = r.def.plafond.length ? Math.min(...r.def.plafond) : null;
      r.attPlafond = r.att.plafond.length ? Math.min(...r.att.plafond) : null;
      return r;
    }

    /** Pourcentage d'XP (formule du classeur, validée avec la cochenille). */
    function xpPct({ enemy, sent, eArmes, eMult, aArmes, aBouclier, cochenille }) {
      const M = enemy.reduce((s, [c, n]) => s + n * UNITS[c].xp, 0);
      const N = sent.reduce((s, [c, n]) => s + n * UNITS[c].xp, 0);
      if (!N) return 0;
      return Math.pow(M / N, 2) * 43.56 * (1 + cochenille / 10) * (1 + eArmes / 10) * eMult / (1 + aBouclier / 10) / (1 + aArmes / 10);
    }

    /** One-shot avec XP < 100 % : on retrouve la vie exacte du défenseur. */
    function multFromXp(r, aBouclier, cochenille) {
      const c = r.combat;
      if (!r.oneShot || !c.xp.length || r.defArmes == null || r.attArmes == null || aBouclier == null) return null;
      // survivants par type (les pertes suivent l'ordre de l'armée)
      const surv = Object.fromEntries(killInOrder(c.attackers, c.dmg[1] ? c.dmg[1].kills : 0).rest);
      let best = null;
      for (const { from, n } of c.xp) {
        const base = surv[from] || 0;
        if (base <= 0) continue;
        const pct = (n / base) * 100;
        if (!best || from !== 'JSN') best = { from, pct };
      }
      if (!best || best.pct >= 99.5) return { full: true };
      const unit = xpPct({ enemy: c.defenders, sent: c.attackers, eArmes: r.defArmes, eMult: 1, aArmes: r.attArmes, aBouclier, cochenille });
      return { full: false, pct: best.pct, mult: best.pct / unit };
    }

    function combos(mult, place) {
      if (mult == null) return [];
      if (place === 'terrain') { const b = (mult - 1) * 10; return nearInt(b, 0.05) ? [{ bouclier: Math.round(b), niveau: 0 }] : []; }
      const fixed = place === 'loge' ? 0.3 : 0.1, step = place === 'loge' ? 0.15 : 0.05, out = [];
      for (let b = 0; b <= MAX; b++) {
        const x = (mult - 1 - 0.1 * b - fixed) / step;
        if (x >= -0.01 && x <= MAX + 0.01 && nearInt(x, 0.03)) out.push({ bouclier: b, niveau: Math.round(x) });
      }
      return out;
    }

    /** Fusionne les infos par joueur et croise les rapports. */
    function players(analyses, me) {
      const P = {};
      const get = (name) => (P[name.toLowerCase()] = P[name.toLowerCase()] || { name, armes: [], bouclier: [], lieux: { terrain: [], dome: [], loge: [] }, plafonds: { terrain: [], dome: [], loge: [] }, cands: {} });
      for (const r of analyses) {
        const h = r.combat.header || {};
        const an = h.att || me, dn = h.def || me;
        if (an) {
          const p = get(an);
          if (r.attArmes != null) p.armes.push(r.attArmes);
          if (r.attMult) p.bouclier.push((r.attMult - 1) * 10);
        }
        if (dn) {
          const p = get(dn);
          if (r.defArmes != null) p.armes.push(r.defArmes);
          const place = h.place || null;
          const m = r.defMult || (r.xpMult && !r.xpMult.full ? r.xpMult.mult : null);
          if (place && m) { p.lieux[place].push(m); if (r.defMult && r.defCands && r.defCands.length > 1) (p.cands[place] = p.cands[place] || []).push(r.defCands); }
          else if (place && r.defPlafond) p.plafonds[place].push(r.defPlafond);
        }
      }
      for (const p of Object.values(P)) {
        p.armesLvl = p.armes.length ? Math.round(median(p.armes)) : null;
        const bs = p.bouclier.filter((b) => nearInt(b, 0.05)).map(Math.round);
        p.bouclierLvl = bs.length ? median(bs) : null;
        if (p.lieux.terrain.length && p.bouclierLvl == null) {
          const b = (median(p.lieux.terrain) - 1) * 10;
          if (nearInt(b, 0.05)) p.bouclierLvl = Math.round(b);
        }
        p.res = {};
        for (const place of ['dome', 'loge']) {
          const ms = p.lieux[place];
          if (!ms.length) continue;
          let m = median(ms);
          // fourchette (petit rapport) : toutes les valeurs possibles, communes aux rapports
          let cands = [m];
          if (p.cands[place]) {
            cands = p.cands[place].reduce((acc, cs) => acc.filter((x) => cs.some((y) => Math.abs(x - y) < 1e-6)));
            if (!cands.length) cands = [m];
          }
          let c = [];
          for (const mm of cands) c.push(...combos(mm, place).map((x) => Object.assign(x, { mult: mm })));
          if (p.bouclierLvl != null) c = c.filter((x) => x.bouclier === p.bouclierLvl);
          const hyp = p.armesLvl != null ? c.filter((x) => x.bouclier <= p.armesLvl).sort((x, y) => y.bouclier - x.bouclier || y.mult - x.mult)[0] : null;
          if (hyp) m = hyp.mult; else m = Math.max(...cands);
          p.res[place] = { mult: m, combos: c, hyp: c.length > 1 ? hyp : null, cands: cands.length > 1 ? cands : null };
        }
        // croisement dôme × loge sans bouclier connu
        if (p.bouclierLvl == null && p.res.dome && p.res.loge) {
          const bD = new Set(p.res.dome.combos.map((x) => x.bouclier));
          const commun = p.res.loge.combos.filter((x) => bD.has(x.bouclier)).map((x) => x.bouclier);
          if (commun.length === 1) {
            p.bouclierLvl = commun[0];
            for (const pl of ['dome', 'loge']) p.res[pl].combos = p.res[pl].combos.filter((x) => x.bouclier === commun[0]);
          }
        }
      }
      return Object.values(P);
    }

    /** Plan d'attaque pour passer en un tour avec un maximum d'XP. */
    function plan({ enemy, eArmes, eMult, place, my, unit = 'T' }) {
      const U = UNITS;
      const secu = my.secu || 1.02;
      const vieABattre = sumBy(enemy, 'vie') * eMult * secu;
      const bonusAtt = 1 + my.armes / 10;
      const attBase = vieABattre / bonusAtt;
      const replique10 = sumBy(enemy, 'def') * (1 + eArmes / 10) / 10;
      const jsn = Math.ceil(replique10 / (U.JSN.vie * (1 + my.bouclier / 10)));
      const jsnMarge = Math.ceil(jsn * (1 + (my.tampon == null ? 5 : my.tampon) / 100));
      const M = enemy.reduce((s, [c, n]) => s + n * U[c].xp, 0);
      const K = 43.56 * (1 + my.cochenille / 10) * (1 + eArmes / 10) * eMult / (1 + my.bouclier / 10) / bonusAtt;
      const Nmax = M * Math.sqrt(K / 100); // armée pondérée au-delà de laquelle l'XP passe sous 100 %
      const u = U[unit];
      const nMin = Math.max(0, Math.ceil((attBase - jsnMarge * U.JSN.att) / u.att));
      const nXp = Math.max(0, Math.floor((Nmax - jsnMarge * U.JSN.xp) / u.xp));
      const n = Math.max(nMin, nXp);
      const army = [['JSN', jsnMarge], [unit, n]];
      const pct = Math.min(100, xpPct({ enemy, sent: army, eArmes, eMult, aArmes: my.armes, aBouclier: my.bouclier, cochenille: my.cochenille }));
      return { vieABattre, attBase, replique10, jsn, jsnMarge, nMin, nXp, n, unit, pct, place, evolue: u.pex ? Math.floor(n * pct / 100) : 0 };
    }

    function analyseText(text, my) {
      const combats = parseReports(text);
      const analyses = combats.map(analyseCombat);
      const me = my.pseudo || 'Moi';
      const pre = players(analyses, me).find((p) => p.name.toLowerCase() === me.toLowerCase());
      const eff = Object.assign({}, my, {
        armes: my.armes || (pre && pre.armesLvl) || 0,
        bouclier: 0, source: {},
      });
      eff.source.armes = my.armes ? 'réglage' : (pre && pre.armesLvl != null ? 'rapports' : 'défaut');
      if (my.bouclier) { eff.bouclier = my.bouclier; eff.source.bouclier = 'réglage'; }
      else if (pre && pre.bouclierLvl != null) { eff.bouclier = pre.bouclierLvl; eff.source.bouclier = 'rapports'; }
      else if (eff.armes) { eff.bouclier = eff.armes; eff.source.bouclier = 'supposé = armes'; }
      else eff.source.bouclier = 'inconnu';
      for (const r of analyses) {
        const h = r.combat.header || {};
        const iAmAtt = !h.att;
        const aB = r.attMult ? Math.round((r.attMult - 1) * 10) : (iAmAtt ? eff.bouclier : null);
        r.xpMult = multFromXp(r, aB, my.cochenille);
      }
      return { combats, analyses, players: players(analyses, me), my: eff };
    }

    /** Lit une armée collée : « 1 000 Tanks, … » ou « Tanks 1 000 » (une unité par ligne). Les doublons s'additionnent. */
    function parseArmyLoose(text) {
      const clean = String(text || '').replace(/\[\/?[a-z]+(?:=[^\]]*)?\]/gi, '');
      const tot = {};
      const add = (code, n) => { if (code && n > 0) tot[code] = (tot[code] || 0) + n; };
      // format « nombre unité »
      const a = parseArmy(clean.replace(/\n/g, ', '));
      // format « unité nombre » (page Armée)
      const b = [];
      const re = /([A-Za-zÀ-ÿ’' ]{3,}?)\s*[:\t ]\s*(\d[\d \u00a0\u202f]*)/g;
      let m;
      for (const line of clean.split(/\r?\n/)) {
        re.lastIndex = 0;
        while ((m = re.exec(line))) { const c = unitCode(m[1]); if (c) b.push([c, toInt(m[2])]); }
      }
      (b.length > a.length ? b : a).forEach(([c, n]) => add(c, n));
      return Object.keys(UNITS).filter((c) => tot[c]).map((c) => [c, tot[c]]);
    }

    // gain de puissance d'une évolution (Δvie + Δatt + Δdéf), pour classer les unités à faire évoluer
    const GAIN = Object.fromEntries(Object.entries(EVOL).map(([f, t]) => [f, (UNITS[t].vie - UNITS[f].vie) + (UNITS[t].att - UNITS[f].att) + (UNITS[t].def - UNITS[f].def)]));

    /** Pertes : la réplique tue dans l'ordre de l'armée, chaque unité a sa vie × bouclier. */
    function lossesByDamage(army, dmg, bB) {
      const out = [];
      for (const [c, n] of army) {
        const per = UNITS[c].vie * bB;
        const k = Math.min(n, Math.floor(dmg / per));
        dmg -= k * per;
        out.push([c, k]);
        if (k < n) dmg = 0;
      }
      return out;
    }

    /**
     * Envoi optimal depuis l'armée disponible :
     *  1) JSN tampon pour encaisser la réplique,
     *  2) atteindre l'attaque requise avec le moins de « poids XP » possible (meilleur ratio attaque / coefficient XP),
     *  3) s'il reste de la marge sous 100 % d'XP, ajouter des unités qui évoluent (meilleur gain / poids XP).
     */
    function optimize({ enemy, eArmes, eMult, my, avail, facteur = 0.1, cibles = ['T'] }) {
      const order = Object.keys(UNITS);
      const bA = 1 + my.armes / 10, bB = 1 + my.bouclier / 10, secu = my.secu || 1.02;
      const have = Object.fromEntries(order.map((c) => [c, 0]));
      avail.forEach(([c, n]) => (have[c] += n));
      const send = Object.fromEntries(order.map((c) => [c, 0]));
      const vieABattre = sumBy(enemy, 'vie') * eMult * secu;
      const attReq = vieABattre / bA;
      const replique = sumBy(enemy, 'def') * (1 + eArmes / 10) * facteur;
      const jsnNeed = Math.ceil(replique / (UNITS.JSN.vie * bB));
      const jsnMarge = Math.ceil(jsnNeed * (1 + (my.tampon == null ? 5 : my.tampon) / 100));
      const M = enemy.reduce((s, [c, n]) => s + n * UNITS[c].xp, 0);
      const K = 43.56 * (1 + (my.cochenille || 0) / 10) * (1 + eArmes / 10) * eMult / bB / bA;
      const Nmax = M * Math.sqrt(K / 100);

      // 1) tampon
      send.JSN = Math.min(have.JSN, jsnMarge);
      let att = send.JSN * UNITS.JSN.att;
      const poids = () => order.reduce((s, c) => s + send[c] * UNITS[c].xp, 0);
      // unités choisies qui frappent (les JSN au-delà du tampon ne servent qu'à l'XP)
      const mix = order.filter((c) => c !== 'JSN' && UNITS[c].pex && cibles.includes(c) && UNITS[c].att > 1);
      // 2) attaque requise : d'abord partagée à parts égales entre les unités choisies (mélange),
      //    puis complétée par les unités les plus légères en poids XP
      for (let tour = 0; tour < 5 && att < attReq; tour++) {
        const dispo = mix.filter((c) => have[c] - send[c] > 0);
        if (!dispo.length) break;
        const part = (attReq - att) / dispo.length;
        for (const c of dispo) {
          const k = Math.min(have[c] - send[c], Math.ceil(part / UNITS[c].att));
          send[c] += k; att += k * UNITS[c].att;
        }
      }
      const byAtt = order.filter((c) => have[c] - send[c] > 0 && UNITS[c].att > 1 && c !== 'JSN')
        .sort((x, y) => UNITS[y].att / UNITS[y].xp - UNITS[x].att / UNITS[x].xp);
      for (const c of [...byAtt, 'JSN']) {
        if (att >= attReq) break;
        const k = Math.min(have[c] - send[c], Math.ceil((attReq - att) / UNITS[c].att));
        if (k > 0) { send[c] += k; att += k * UNITS[c].att; }
      }
      const passe = att >= attReq;
      // 3) marge sous 100 % d'XP : partagée à parts égales (en poids XP) entre les unités choisies
      if (passe) {
        const fill = order.filter((c) => UNITS[c].pex && cibles.includes(c));
        for (let tour = 0; tour < 5; tour++) {
          const room = Nmax - poids();
          const dispo = fill.filter((c) => have[c] - send[c] > 0);
          if (room <= 1 || !dispo.length) break;
          const part = room / dispo.length;
          let ajout = 0;
          for (const c of dispo) {
            const k = Math.min(have[c] - send[c], Math.floor(part / UNITS[c].xp));
            if (k > 0) { send[c] += k; att += k * UNITS[c].att; ajout += k; }
          }
          if (!ajout) break;
        }
      }
      const army = order.filter((c) => send[c] > 0).map((c) => [c, send[c]]);
      const pct = Math.min(100, xpPct({ enemy, sent: army, eArmes, eMult, aArmes: my.armes, aBouclier: my.bouclier, cochenille: my.cochenille || 0 }));
      const losses = Object.fromEntries(lossesByDamage(army, replique, bB));
      const rows = army.map(([c, n]) => {
        const surv = n - (losses[c] || 0);
        const evol = UNITS[c].pex && passe ? Math.floor(surv * pct / 100) : 0;
        return { c, dispo: have[c], envoi: n, pertes: losses[c] || 0, evol, vers: EVOL[c] || null };
      });
      const pertesHorsJSN = rows.filter((r) => r.c !== 'JSN').reduce((s, r) => s + r.pertes, 0);
      return {
        rows, passe, att, attReq, vieABattre, replique, jsnNeed, jsnMarge, pct, Nmax,
        frappe: att * bA, vieAdverse: vieABattre / secu,
        manqueAtt: passe ? 0 : attReq - att,
        jsnManque: Math.max(0, jsnNeed - have.JSN), pertesHorsJSN,
        gain: rows.reduce((s, r) => s + r.evol * (GAIN[r.c] || 0), 0),
      };
    }

    /* ---------------- Simulateur de combat ----------------
     * Règles mesurées sur les rapports et le simulateur du jeu :
     *  - dégâts affichés = arrondi supérieur de la base, et de base × armes/10 ;
     *  - les tués suivent l'ordre de l'armée, arrondis à l'unité inférieure, le reste des dégâts est perdu ;
     *  - les deux camps frappent en même temps, avec les unités vivantes au début du tour ;
     *  - si tout le défenseur meurt au 1er tour, sa réplique est divisée par 10 (« Écrasante victoire ») ;
     *  - XP de l'attaquant vainqueur : même % pour toutes les unités qui évoluent, sauf l'unité blessée. */
    const NOMS = {
      JSN: ['Jeune Soldate Naine', 'Jeunes Soldates Naines'], SN: ['Soldate Naine', 'Soldates Naines'], NE: ['Naine d’Elite', 'Naines d’Elites'],
      JS: ['Jeune Soldate', 'Jeunes Soldates'], S: ['Soldate', 'Soldates'], C: ['Concierge', 'Concierges'], CE: ['Concierge d’élite', 'Concierges d’élites'],
      A: ['Artilleuse', 'Artilleuses'], AE: ['Artilleuse d’élite', 'Artilleuses d’élites'], SE: ['Soldate d’élite', 'Soldates d’élites'],
      T: ['Tank', 'Tanks'], TE: ['Tank d’élite', 'Tanks d’élites'], Tu: ['Tueuse', 'Tueuses'], TuE: ['Tueuse d’élite', 'Tueuses d’élites'],
    };
    const nomUnite = (c, n) => NOMS[c][n > 1 ? 1 : 0];
    const ceilAff = (x) => Math.ceil(x - 1e-6);
    function multLieu(bouclier, lieu) {
      const b = 1 + bouclier / 10;
      if (!lieu || lieu.type === 'terrain') return b;
      if (lieu.type === 'dome') return b + 0.1 + 0.05 * (lieu.dome || 0);
      return b + 0.3 + 0.15 * (lieu.loge || 0);
    }
    function frapper(army, dmg, mult) {
      let rem = dmg, blesse = null;
      const morts = army.map(([c, n]) => {
        if (rem <= 0 || n <= 0) return [c, 0];
        const per = UNITS[c].vie * mult;
        const k = Math.min(n, Math.floor(rem / per + 1e-9));
        rem -= k * per;
        if (k < n) { if (rem > 1e-6) blesse = c; rem = 0; }
        return [c, k];
      });
      return { morts, blesse };
    }
    function simulate({ att, def, tech, lieu }) {
      const t = Object.assign({ aB: 0, aA: 0, aC: 0, dB: 0, dA: 0, dC: 0 }, tech || {});
      const order = Object.keys(UNITS);
      let A = order.map((c) => [c, Math.max(0, Math.floor(att[c] || 0))]);
      let D = order.map((c) => [c, Math.max(0, Math.floor(def[c] || 0))]);
      const A0 = A.map((x) => [...x]), D0 = D.map((x) => [...x]);
      const mA = 1 + t.aB / 10, mD = multLieu(t.dB, lieu);
      const tot = (a) => a.reduce((s, [, n]) => s + n, 0);
      const rounds = [];
      let blesseA = null;
      for (let r = 1; r <= 100 && tot(A) > 0 && tot(D) > 0; r++) {
        const aExact = sumBy(A, 'att');
        const hitD = frapper(D, aExact * (1 + t.aA / 10), mD);
        const kD = hitD.morts.reduce((s, [, k]) => s + k, 0);
        const facteur = r === 1 && kD >= tot(D) ? 0.1 : 1;
        const dExact = sumBy(D, 'def') * facteur;
        const hitA = frapper(A, dExact * (1 + t.dA / 10), mA);
        const kA = hitA.morts.reduce((s, [, k]) => s + k, 0);
        rounds.push({ aBase: ceilAff(aExact), aBonus: ceilAff(aExact * t.aA / 10), kD, dBase: ceilAff(dExact), dBonus: ceilAff(dExact * t.dA / 10), kA, facteur });
        D = D.map(([c, n], i) => [c, n - hitD.morts[i][1]]);
        A = A.map(([c, n], i) => [c, n - hitA.morts[i][1]]);
        blesseA = hitA.blesse;
      }
      const aVivant = tot(A) > 0, dVivant = tot(D) > 0;
      const issue = aVivant && !dVivant ? 'att' : !aVivant && dVivant ? 'def' : !aVivant && !dVivant ? 'nul' : 'egal';
      let xp = null;
      if (issue === 'att') {
        const pct = xpPct({ enemy: D0.filter(([, n]) => n > 0), sent: A0.filter(([, n]) => n > 0), eArmes: t.dA, eMult: mD, aArmes: t.aA, aBouclier: t.aB, cochenille: t.aC });
        const f = Math.min(1, pct / 100);
        const evol = A.filter(([c, n]) => UNITS[c].pex && n > 0)
          .map(([c, n]) => [c, Math.floor((n - (c === blesseA ? 1 : 0)) * f + 1e-9)]).filter(([, n]) => n > 0);
        xp = { pct, evol };
      }
      const apres = Object.fromEntries(A);
      if (xp) for (const [c, n] of xp.evol) { apres[c] -= n; apres[EVOL[c]] = (apres[EVOL[c]] || 0) + n; }
      return {
        rounds, issue, oneShot: issue === 'att' && rounds.length === 1, xp, mA, mD,
        apresAtt: apres, apresDef: Object.fromEntries(D),
        totaux: { aVie: sumBy(A0, 'vie') * mA, aDeg: sumBy(A0, 'att') * (1 + t.aA / 10), dVie: sumBy(D0, 'vie') * mD, dDeg: sumBy(D0, 'def') * (1 + t.dA / 10) },
        A0, D0,
      };
    }
    const nbFr = (n) => Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
    function messageSimu(res, position) {
      const liste = (a) => a.filter(([, n]) => n > 0).map(([c, n]) => `${nbFr(n)} ${nomUnite(c, n)}`).join(', ') + '.';
      const L = [`Troupes en attaque : ${liste(res.A0)}`, `Troupes en défense : ${liste(res.D0)}`, ''];
      for (const r of res.rounds) {
        const a = `${nbFr(r.aBase)} (+ ${nbFr(r.aBonus)})`, d = `${nbFr(r.dBase)} (+ ${nbFr(r.dBonus)})`;
        if (position === 'def') L.push(`L’ennemie inflige ${a} dégâts à vos fourmis et en tue ${nbFr(r.kD)}.`, `Vous infligez ${d} dégâts et tuez ${nbFr(r.kA)} ennemies.`);
        else L.push(`Vous infligez ${a} dégâts et tuez ${nbFr(r.kD)} ennemies.`, `L’ennemie inflige ${d} dégâts à vos fourmis et en tue ${nbFr(r.kA)}.`);
        L.push('');
      }
      const gagne = position === 'def' ? res.issue === 'def' : res.issue === 'att';
      if (res.issue === 'att') L.push(res.oneShot ? 'Écrasante victoire ! A peine le temps de se dégourdir les pattes qu’ils étaient tous morts ...' : 'L’adversaire y a cru, mais vous sortez victorieux de ce combat acharné.');
      if (res.issue === 'nul') L.push('Les deux armées se sont entretuées.');
      if (res.issue === 'egal') L.push('Combat interrompu après 100 tours.');
      L.push(res.issue === 'nul' || res.issue === 'egal' ? 'Match nul.' : gagne ? 'Vous avez gagné cette bataille !' : 'Vous avez perdu cette bataille !');
      if (res.xp && res.xp.evol.length && position !== 'def') {
        L.push('', 'Les unités survivantes ont appris de cette bataille :');
        for (const [c, n] of res.xp.evol) L.push(`- ${nbFr(n)} ${nomUnite(c, n)} sont devenues des ${NOMS[EVOL[c]][1]}`);
      }
      return L.join('\n');
    }

    /* ---------------- VA (formule de FourmiWatch) et TdP (formule d'OlympusBot) ---------------- */
    const T0 = (d) => 637200 * (1 - Math.exp(-d / 350));   // trajet à VA 0, en secondes
    const trajet = (d, va) => T0(d) * Math.pow(0.9, va);     // chaque niveau de VA : × 0,9
    const vaDepuisTrajet = (d, s) => Math.log(s / T0(d)) / Math.log(0.9);
    function dureeLue(t) {
      t = String(t || '').toLowerCase().replace(',', '.').trim();
      const hms = t.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
      if (hms) return hms[3] != null ? +hms[1] * 3600 + +hms[2] * 60 + +hms[3] : +hms[1] * 3600 + +hms[2] * 60;
      let s = 0, ok = false;
      for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(j|d|h|m(?:in)?|s)/g)) { ok = true; s += +m[1] * ({ j: 86400, d: 86400, h: 3600, m: 60, min: 60, s: 1 }[m[2]] || 0); }
      return ok ? Math.round(s) : null;
    }
    function dureeTexte(s) {
      s = Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
      const j = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
      const p = (v) => String(v).padStart(2, '0');
      return j ? `${j} j ${h} h ${p(m)}` : h ? `${h} h ${p(m)} min ${p(x)} s` : m ? `${m} min ${p(x)} s` : `${x} s`;
    }
    const TDP_CONST = 1 / Math.log(10 / 9);                  // chaque niveau accélère la ponte de ×10/9
    const TDP_BASE = { JSN: 300, SN: 450, NE: 570, JS: 740, S: 1000, A: 1440, AE: 1520, SE: 1450, T: 1860, TE: 1860, Tu: 2740, TuE: 2740 };
    function tdp({ p1, k, p2, x, t, tp }) {
      const u = (p2 + k + x) - p1;
      if (!(u > 0) || !(t > 0) || !(tp > 0)) return { u, tdp: null };
      return { u, tdp: TDP_CONST * (Math.log(tp / t) + Math.log(u)) };
    }

    /** Date d'un rapport : « 13/11/14 à 12h48 » ou « 16/02/21 22h02 » (heure du jeu). */
    function dateRc(text) {
      const m = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:à\s*)?(\d{1,2})[h:](\d{2})(?:[:m](\d{2}))?/);
      if (!m) return null;
      const an = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      return new Date(an, +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
    }
    /** Armée du défenseur avant le combat et pertes par type (tous les tours, dans l'ordre de l'armée). */
    function defenseEtPertes(c) {
      const tues = c.dmg.filter((_, i) => i % 2 === 0).reduce((s, d) => s + d.kills, 0);
      const { rest } = killInOrder(c.defenders, tues);
      const av = Object.fromEntries(c.defenders), ap = Object.fromEntries(rest);
      const pertes = Object.fromEntries(Object.keys(av).map((k) => [k, av[k] - (ap[k] || 0)]));
      return { avant: av, pertes, apres: ap };
    }
    /** TdP à partir de deux sondes : unités pondues par type = (p2 + tués au RC1 + évoluées) − p1. */
    function tdpDepuisRcs(txt1, txt2, opts = {}) {
      const c1 = parseReports(txt1)[0], c2 = parseReports(txt2)[0];
      if (!c1 || !c2) return { erreur: 'Rapport illisible : colle les deux rapports complets (troupes et dégâts).' };
      const t1 = opts.t1 || dateRc(txt1), t2 = opts.t2 || dateRc(txt2);
      if (!t1 || !t2) return { erreur: 'Date introuvable dans un des rapports : indique-la à la main.' };
      const t = (t2 - t1) / 1000;
      if (!(t > 0)) return { erreur: 'Le RC 2 doit être postérieur au RC 1.' };
      const d1 = defenseEtPertes(c1), d2 = defenseEtPertes(c2);
      const evol = opts.evol || {};
      const types = Object.keys(UNITS).filter((k) => d1.avant[k] != null || d2.avant[k] != null);
      const lignes = types.map((k) => {
        const p1 = d1.avant[k] || 0, kk = d1.pertes[k] || 0, p2 = d2.avant[k] || 0, x = evol[k] || 0;
        const u = p2 + kk + x - p1;
        const tp = TDP_BASE[k];
        const r = tp && u > 0 ? tdp({ p1, k: kk, p2, x, t, tp }).tdp : null;
        return { c: k, p1, k: kk, p2, x, u, tdp: r, parSec: u > 0 ? u / t : 0 };
      });
      const valides = lignes.filter((l) => l.tdp != null);
      const best = valides.sort((a, b) => b.u - a.u)[0] || null;
      const def1 = (c1.header && c1.header.def) || null, def2 = (c2.header && c2.header.def) || null;
      return { t, t1, t2, lignes, best, nom: def2 || def1, memeJoueur: !def1 || !def2 || def1.toLowerCase() === def2.toLowerCase(), apresRc2: d2.apres, pertesRc2: d2.pertes };
    }

    /** Rythme de ponte (unités par seconde) d'après le niveau de TdP : (10/9)^TdP / tp. */
    const rythmePonte = (niveau, tp) => Math.pow(10 / 9, niveau) / tp;
    /**
     * Heure de départ de l'armée adverse : quand elle part, la fourmilière est vide ; tout ce qu'on trouve au RC
     * (pour l'unité qu'il pond) a été pondu depuis son départ. Départ = date du RC − unités ÷ rythme de ponte.
     */
    function departDepuisRc(txt, { tdp: niveau, rythme, unite, date, stock = 0 } = {}) {
      const c = parseReports(txt)[0];
      if (!c) return { erreur: 'Rapport illisible : colle le rapport complet (troupes et dégâts).' };
      const t = date || dateRc(txt);
      if (!t) return { erreur: 'Date introuvable dans le rapport : indique-la à la main.' };
      const def = Object.fromEntries(c.defenders);
      const candidats = Object.keys(TDP_BASE).filter((k) => def[k] > 0).sort((a, b) => def[b] - def[a]);
      const u = unite && def[unite] != null ? unite : (unite || candidats[0]);
      if (!u) return { erreur: 'Aucune unité pondable dans la défense de ce rapport.' };
      const n = def[u] || 0;
      const r = rythme || (niveau != null && TDP_BASE[u] ? rythmePonte(niveau, TDP_BASE[u]) : null);
      if (!r) return { erreur: 'Indique le niveau de TdP (ou colle un 2e RC pour le mesurer).' };
      const pondues = Math.max(0, n - (stock || 0));
      const ecoule = pondues / r;
      return { t, unite: u, n, stock: stock || 0, pondues, rythme: r, ecoule, depart: t - ecoule * 1000, autres: candidats.filter((k) => k !== u).map((k) => [k, def[k]]), nom: (c.header && c.header.def) || null };
    }

    /* ---------------- VA d'après les mouvements relevés par OlympusBot (méthodes de FourmiWatch) ----------------
     * Un mouvement de TDC relevé au scan « ts » a eu lieu depuis le scan précédent « debut » : on raisonne sur cette
     * fenêtre réelle (quelques minutes pour C6P, jusqu'à une heure pour les autres) plutôt que sur une marge fixe.
     * Une prise de TDC n'est effective qu'à la fin de la minute qui suit l'arrivée, plus 9 s :
     * arrivée = prise − 70 à 129 s. Temps en millisecondes, trajets et écarts en secondes. */
    const VA_MAX = 30;
    const MARGE_SCAN = 10 * 60;           // fenêtre supposée quand le scan précédent est inconnu (s)
    const PRISE_MIN = 70, PRISE_MAX = 129; // délai arrivée → prise effective (s)
    const debutFenetre = (m) => (m.debut != null && m.debut < m.ts && m.ts - m.debut < 6 * 3600000 ? m.debut : m.ts - MARGE_SCAN * 1000);
    /** VA minimale pour qu'un trajet de distance d tienne en « ecart » secondes. */
    const vaMinPour = (ecart, d) => { const f = ecart / T0(d); return f >= 1 ? 0 : Math.ceil(Math.log(f) / Math.log(0.9) - 1e-9); };

    /**
     * Enchaînements : une attaque de TDC ne fait que l'aller (l'armée rentre instantanément à la fin de la minute).
     * Entre deux arrivées, il faut au moins le trajet vers la 2e victime : chaque écart donne une VA minimale.
     * Attaques arrivées à moins de 15 min d'intervalle = une même vague (plusieurs armées).
     * VA retenue : la plus haute qui revient (à 1 niveau près) sur au moins 30 % des enchaînements, 3 au minimum ;
     * au-delà de 1 niveau, c'est une double attaque (armées en parallèle). attaques : [{ ts, debut, d, victime, flood }].
     */
    function vaEnchainements(attaques, { vaMax = VA_MAX } = {}) {
      const liste = [...attaques].sort((a, b) => a.ts - b.ts);
      const vagues = [];
      for (const a of liste) {
        const v = vagues[vagues.length - 1];
        if (v && a.ts - v.fin <= 15 * 60000) { v.fin = a.ts; v.n++; v.flood = v.flood && !!a.flood; }
        else vagues.push({ prem: a, fin: a.ts, n: 1, flood: !!a.flood });
      }
      const indices = [];
      for (let i = 1; i < vagues.length; i++) {
        const A = vagues[i - 1].prem, B = vagues[i].prem;
        // écart le plus long possible entre les deux arrivées (bornes des fenêtres de scan et délai de prise) :
        // la VA minimale qui en découle est sûre, même avec des relevés espacés
        const ecartMax = (B.ts - debutFenetre(A)) / 1000 + (PRISE_MAX - PRISE_MIN);
        const ecartMin = Math.max(0, (debutFenetre(B) - A.ts) / 1000 - (PRISE_MAX - PRISE_MIN));
        const vaMin = vaMinPour(ecartMax, B.d);
        indices.push({ de: A, a: B, ecartMin, ecartMax, base: T0(B.d), vaMin, plausible: vaMin <= vaMax, flood: vagues[i - 1].flood || vagues[i].flood });
      }
      const bornes = indices.filter((x) => x.plausible && x.vaMin > 0).map((x) => x.vaMin).sort((a, b) => b - a);
      let va = null, confiance = 'aucune';
      if (bornes.length) {
        const appui = (v) => bornes.filter((w) => w === v || w === v - 1).length;
        const seuil = Math.max(3, Math.ceil(bornes.length * 0.3));
        // la VA retenue doit elle-même revenir au moins 2 fois : une seule double attaque à VA + 1 ne la fait pas monter
        const v1 = bornes.find((v) => appui(v) >= seuil && bornes.filter((w) => w === v).length >= 2);
        if (v1 != null) { va = v1; confiance = appui(v1) >= Math.max(5, bornes.length * 0.4) ? 'bonne' : 'moyenne'; }
        else { const v2 = bornes.find((v) => appui(v) >= 2); va = v2 != null ? v2 : bornes[bornes.length - 1]; confiance = 'faible'; }
      }
      // Une seule armée : l'enchaînement le plus serré est forcément une relance
      const serres = indices.filter((x) => x.plausible && x.vaMin > 0).sort((a, b) => b.vaMin - a.vaMin || a.ecartMax - b.ecartMax);
      const serre = serres[0] || null;
      let relance = null;
      if (serre) {
        const t = serre.base * Math.pow(0.9, serre.vaMin);
        // délai entre l'arrivée précédente et la relance, au plus (fenêtres de scan comprises)
        relance = { delai: Math.max(0, serre.ecartMax - t), trajet: t, pas: t * 0.1, ...serre };
      }
      const suspect = serres[1] && serre.vaMin - serres[1].vaMin >= 3 ? serres[1].vaMin : null;
      const partFloods = indices.length ? indices.filter((x) => x.flood).length / indices.length : 0;
      return { attaques: liste.length, vagues: vagues.length, indices, va, confiance, relance, suspect, partFloods };
    }

    /**
     * Remontées de la cible : un joueur relance souvent une 2e armée sur une cible qui vient de regagner du terrain
     * (chasse, flood reçu) alors que la 1re est encore en route. L'écart entre les deux arrivées est alors plus court
     * que le trajet, et l'enchaînement exige un niveau de VA de trop.
     * Pour la VA v retenue, si tous les enchaînements qui exigent v s'expliquent par une remontée de leur cible entre
     * les deux lancements (calculés à v − 1), et que v − 1 revient assez souvent, la VA retenue redescend à v − 1.
     * hist(nom) : historique de TDC de la victime ({ ev: [{ ts, avant, apres }] }), ou null s'il est inconnu.
     */
    function remonteeEntre(x, v, hist) {
      const h = hist(x.a.victime);
      if (!h) return null;
      const arr = (m) => m.ts - ((PRISE_MIN + PRISE_MAX) / 2) * 1000; // arrivée estimée au milieu du délai de prise
      const lanceA = arr(x.de) - trajet(x.de.d, v) * 1000, lanceB = arr(x.a) - trajet(x.a.d, v) * 1000;
      if (lanceB >= arr(x.de)) return null; // à v, la 1re armée était déjà arrivée : pas besoin d'une 2e
      // gain de terrain de la cible entre les deux lancements (relevés à quelques minutes près)
      const g = h.ev.filter((e) => e.apres > e.avant && e.ts >= lanceA - 10 * 60000 && e.ts <= lanceB + 5 * 60000).pop();
      return g ? { cm: g.apres - g.avant, t: g.ts, lanceB } : null;
    }
    function departagerRemontees(est, hist) {
      const valides = est.indices.filter((x) => x.plausible && x.vaMin > 0);
      let va = est.va;
      const expliques = [];
      while (va != null && va > 0) {
        const hauts = valides.filter((x) => x.vaMin === va), bas = valides.filter((x) => x.vaMin === va - 1).length;
        if (!hauts.length || bas < Math.max(3, hauts.length)) break;
        const r = hauts.map((x) => ({ x, r: remonteeEntre(x, va - 1, hist) }));
        if (r.some((y) => !y.r)) return { va, expliques, alternative: { va: va - 1, n: hauts.length, expliques: r.filter((y) => y.r).length } };
        r.forEach((y) => { y.x.remontee = y.r; });
        expliques.push(...r);
        va -= 1;
      }
      return { va, expliques, alternative: null };
    }

    /**
     * Départs synchronisés : un joueur lance souvent plusieurs attaques dans la même session vers des cibles à des
     * distances différentes. Pour la bonne VA, « arrivée − trajet » tombe au même moment pour chacune ; pour une
     * mauvaise VA, ces départs se dispersent. Ne dépend pas du nombre d'armées en route (passeurs, floods).
     * Vérifié sur des heures réelles : Greeny VA 9 puis 10 retrouvé avec la date du changement, Vimaire 7 ou 8.
     * attaques : [{ ts, d, victime }] ; arrivée estimée = relevé − 100 s (OlympusBot relève 1 à 6 min après l'arrivée).
     */
    function vaSynchro(attaques, { vaMax = VA_MAX } = {}) {
      const att = [...attaques].sort((a, b) => a.ts - b.ts);
      const parVa = [];
      for (let v = 0; v <= vaMax; v++) {
        const dep = att.map((x) => ({ x, T: trajet(x.d, v), t: x.ts - 100000 - trajet(x.d, v) * 1000 }));
        const paires = [];
        for (let i = 0; i < dep.length; i++) for (let j = i + 1; j < dep.length; j++) {
          const dT = Math.abs(dep[i].T - dep[j].T);
          if (dT < 600) continue; // trajets trop proches : la paire ne départage aucune VA
          // tolérance : 40 % du décalage qu'apporterait un niveau de VA, entre 1,5 et 4 min
          const tol = Math.min(4, Math.max(1.5, 0.4 * dT * 0.1 / 60)) * 60000;
          if (Math.abs(dep[i].t - dep[j].t) <= tol) paires.push({ a: dep[i].x, b: dep[j].x, t: (dep[i].t + dep[j].t) / 2, w: Math.min(1, dT / 2400) });
        }
        // sessions : départs à moins de 5 min les uns des autres
        paires.sort((p, q) => p.t - q.t);
        const sessions = [];
        for (const p of paires) {
          const s = sessions[sessions.length - 1];
          if (s && p.t - s.fin <= 5 * 60000) { s.fin = p.t; s.w = Math.max(s.w, p.w); s.att.add(p.a); s.att.add(p.b); }
          else sessions.push({ debut: p.t, fin: p.t, w: p.w, att: new Set([p.a, p.b]) });
        }
        sessions.forEach((s) => { s.att = [...s.att].sort((p, q) => p.ts - q.ts); });
        parVa.push({ v, score: sessions.reduce((t, s) => t + s.w, 0), sessions });
      }
      // une VA ne fait que monter : meilleure VA unique, ou palier « VA a puis VA b > a à partir d'une date »
      const somme = (l) => l.reduce((t, s) => t + s.w, 0);
      let best = parVa.reduce((m, x) => (x.score > m.score ? x : m), parVa[0]);
      let fit = { va: best.v, score: best.score, avant: null };
      for (const A of parVa) for (const B of parVa) {
        if (B.v <= A.v || A.sessions.length < 2 || B.sessions.length < 2) continue;
        for (const s of B.sessions) {
          const sa = somme(A.sessions.filter((x) => x.debut < s.debut)), sb = somme(B.sessions.filter((x) => x.debut >= s.debut));
          const nA = A.sessions.filter((x) => x.debut < s.debut).length, nB = B.sessions.filter((x) => x.debut >= s.debut).length;
          if (nA >= 2 && nB >= 2 && sa + sb >= fit.score + 1.5)
            fit = { va: B.v, score: sa + sb, avant: { va: A.v, jusqua: Math.max(...A.sessions.filter((x) => x.debut < s.debut).map((x) => x.debut)), depuis: s.debut } };
        }
      }
      // bruit : meilleur score hors de la VA retenue, de son éventuelle VA d'avant et de leurs voisines
      const proches = new Set([fit.va - 1, fit.va, fit.va + 1, ...(fit.avant ? [fit.avant.va - 1, fit.avant.va, fit.avant.va + 1] : [])]);
      const autres = parVa.filter((x) => !proches.has(x.v)).sort((p, q) => q.score - p.score);
      const bruit = autres.length ? autres[0].score : 0;
      // seconde VA possible juste à côté (ordre des lancements ambigu, « 7 ou 8 »)
      const voisine = parVa.filter((x) => Math.abs(x.v - fit.va) === 1 && (!fit.avant || x.v !== fit.avant.va)).sort((p, q) => q.score - p.score)[0];
      const courante = parVa[fit.va];
      const sessionsCourantes = fit.avant ? courante.sessions.filter((s) => s.debut >= fit.avant.depuis) : courante.sessions;
      const alternative = voisine && sessionsCourantes.length && voisine.score >= 0.7 * somme(sessionsCourantes) ? { va: voisine.v, score: voisine.score, n: voisine.sessions.length } : null;
      const confiance = fit.score >= 4 && fit.score >= 2 * bruit ? 'bonne' : fit.score >= 2.5 && fit.score >= 1.5 * bruit ? 'moyenne' : 'insuffisante';
      return { va: fit.va, score: fit.score, sessions: sessionsCourantes, avant: fit.avant, alternative, bruit, confiance, parVa: parVa.map((x) => ({ v: x.v, score: x.score, n: x.sessions.length })) };
    }

    /**
     * Minimum par le nombre d'armées : au plus VA + 1 attaques en route en même temps. Pour chaque VA, chaque attaque
     * occupe une armée de son départ (arrivée − trajet) à son arrivée ; la plus petite VA qui ne dépasse jamais
     * VA + 1 armées est un minimum sûr (les attaques annulées, invisibles sur OlympusBot, ne font que l'augmenter).
     */
    function minArmees(attaques, { vaMax = VA_MAX } = {}) {
      for (let v = 0; v <= vaMax; v++) {
        let max = 0;
        for (const x of attaques) max = Math.max(max, attaques.filter((y) => y.ts - trajet(y.d, v) * 1000 <= x.ts && y.ts >= x.ts).length);
        if (max <= v + 1) return { va: v > 0 ? v : null, armees: max };
      }
      return { va: null, armees: 0 };
    }

    /** TDC d'un joueur à l'instant t d'après son historique { depuis, actuel, ev: [{ ts, avant, apres }] trié }. */
    function tdcA(h, t) {
      if (!h || t < h.depuis) return null;
      let v = h.ev.length ? h.ev[0].avant : h.actuel;
      for (const e of h.ev) { if (e.ts <= t) v = e.apres; else break; }
      return v == null ? null : v;
    }
    /**
     * Plancher par la règle de portée : au départ (arrivée − trajet), la victime avait entre 0,5 et 3 fois le TDC de
     * l'attaquant. Une VA qui ferait partir des attaques hors portée est impossible, même avec plusieurs armées.
     * Une attaque ne compte comme hors portée que si c'est vrai aux deux bouts de sa fenêtre de scan.
     * hist(nom) : historique de la victime ; hist(null) : celui de l'attaquant.
     */
    function plancherPortee(attaques, hist, { vaMax = VA_MAX } = {}) {
      const liste = [...attaques].sort((a, b) => a.ts - b.ts).slice(-25);
      for (let V = 0; V <= vaMax; V++) {
        let ko = 0, n = 0;
        for (const a of liste) {
          const t = trajet(a.d, V) * 1000;
          let vus = 0, hors = 0;
          for (const arr of [a.ts - PRISE_MIN * 1000, debutFenetre(a) - PRISE_MAX * 1000]) {
            const ta = tdcA(hist(null), arr - t), tv = tdcA(hist(a.victime), arr - t);
            if (ta == null || tv == null) continue;
            vus++; if (tv < ta * 0.5 || tv > ta * 3) hors++;
          }
          if (!vus) continue;
          n++; if (hors === vus) ko++;
        }
        // une attaque d'écart tolérée (TDC relevés entre deux scans) pour ne pas conclure sur un seul point
        if (n < 3 || ko <= Math.max(1, Math.floor(n * 0.05))) return { va: V > 0 ? V : null, n };
      }
      return { va: null, n: 0 };
    }

    /**
     * VA à partir d'un départ connu (calculé d'après un RC) et de la fenêtre où sa prise a été relevée :
     * arrivée entre (scan précédent − 129 s) et (scan − 70 s), départ connu à ± precision s.
     * Rend les VA entières compatibles (la formule de trajet peut s'écarter d'une dizaine de secondes).
     */
    function vaDepuisArrivee({ depart, debut, ts, d, precision = 0 }) {
      const arrMin = Math.max(depart + 1000, (debut != null && debut < ts ? debut : ts - MARGE_SCAN * 1000) - PRISE_MAX * 1000);
      const arrMax = ts - PRISE_MIN * 1000;
      if (!(d > 0) || arrMax <= depart) return null;
      const tMin = Math.max(1, (arrMin - depart) / 1000 - precision - 15), tMax = (arrMax - depart) / 1000 + precision + 15;
      const haut = vaDepuisTrajet(d, tMin), bas = vaDepuisTrajet(d, tMax);
      const min = Math.max(0, Math.ceil(bas)), max = Math.floor(haut);
      return { arrMin, arrMax, tMin, tMax, bas, haut, min, max, ok: max >= min };
    }

    return { rythmePonte, departDepuisRc, dateRc, tdpDepuisRcs, NOMS, simulate, messageSimu, multLieu, T0, trajet, vaDepuisTrajet, dureeLue, dureeTexte, tdp, TDP_BASE, toInt,
      vaEnchainements, departagerRemontees, vaSynchro, minArmees, plancherPortee, vaDepuisArrivee, tdcA, VA_MAX, PRISE_MIN, PRISE_MAX, MARGE_SCAN,
      LAB, UNITS, EVOL, GAIN, parseArmyLoose, optimize, parseReports, analyseCombat, analyseText, xpPct, combos, plan, players, sumBy };
  })();

  if (typeof window === 'undefined') { module.exports = Core; return; }

  /* =====================================================================
   *  INTERFACE
   * ===================================================================== */
  const KEY = 'simuOpti';
  const VERSION = '1.13.0'; // aligné sur @version
  // Mode application (APK Android) : la page index.html de l'appli pose ce drapeau avant de charger le script
  const APP = window.SIMUOPTI_APP === true;
  // Page web légère : ni simulateur ni requêtes en ligne (la page pose ce drapeau en plus du mode application)
  const LITE = window.SIMUOPTI_LITE === true;
  const CODE = APP && !LITE; // fonctions en ligne déverrouillées par un code : APK et exe seulement
  const DEFAUT = { armes: 0, bouclier: 0, cochenille: 0, secu: 1.02, tampon: 5, pseudo: '', xpUnits: ['T'], onglet: 'rc', joueurs: {} };
  // Stockage Tampermonkey : hors de portée des scripts du site (contrairement au localStorage de fourmizzz.fr)
  const GM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const loadCfg = () => {
    let v = null;
    try { v = GM ? GM_getValue(KEY, null) : null; } catch (e) { v = null; }
    if (!v) {
      // reprise des versions précédentes, qui écrivaient dans le localStorage du site
      try { const old = localStorage.getItem(KEY) || localStorage.getItem('c6pAnalyseRC'); if (old) v = JSON.parse(old); } catch (e) { /* illisible */ }
    }
    if (GM) {
      try { if (v) GM_setValue(KEY, v); localStorage.removeItem(KEY); localStorage.removeItem('c6pAnalyseRC'); } catch (e) { /* rien à nettoyer */ }
    }
    return Object.assign({}, DEFAUT, v || {});
  };
  const saveCfg = (c) => {
    try { if (GM) GM_setValue(KEY, JSON.parse(JSON.stringify(c))); else localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* stockage indisponible */ }
  };
  let cfg = loadCfg();
  if (!cfg.joueurs) cfg.joueurs = {};

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = (n) => (n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('fr-FR'));
  const fmtUp = (n) => (n == null || !isFinite(n) ? '—' : Math.ceil(n - 1e-6).toLocaleString('fr-FR'));
  const f2 = (n) => (n == null || !isFinite(n) ? '—' : n.toFixed(2).replace('.', ','));
  const LIEU = { dome: 'Dôme', loge: 'Loge', terrain: 'TDC' };
  const ORDER = Object.keys(Core.UNITS);
  const L = (c) => Core.LAB[c] || c;
  function armyStr(a) { return a.map(([c, n]) => `${fmt(n)} ${L(c)}`).join(', '); }
  const joueur = (nom) => (cfg.joueurs[String(nom).toLowerCase()] = cfg.joueurs[String(nom).toLowerCase()] || { nom });

  /* ============================ Fiches joueurs ============================
   * Une fiche par joueur (cfg.joueurs), remplie automatiquement par les onglets :
   *  - Analyse RC : armes, bouclier, niveaux de dôme et de loge (exacts ou supposés), dernière défense vue chez lui ;
   *  - VA & TdP : VA et sa source, TdP, unité pondue, stock, RC de ponte, heure de départ.
   * Le joueur actif (barre « Fiche », onglet Joueurs, ou le dernier joueur travaillé) remplit les autres onglets :
   * défenseur du simulateur et champs de l'onglet VA & TdP. */
  const NIVEAUX = ['armes', 'bouclier', 'dome', 'loge'];
  /** Enregistre des niveaux { armes: { v, sup } … } : un niveau supposé n'écrase jamais un niveau calculé. */
  function noterNiveaux(nom, niv, t) {
    const j = joueur(nom);
    j.sup = j.sup || {};
    for (const k of NIVEAUX) {
      const x = niv[k];
      if (!x || x.v == null || x.v === '') continue;
      if (x.sup && j[k] != null && !j.sup[k]) continue;
      j[k] = x.v;
      if (x.sup) j.sup[k] = true; else delete j.sup[k];
    }
    j.niveauxT = Math.max(j.niveauxT || 0, t || Date.now());
    j.maj = Date.now();
  }
  function noterVa(nom, va, src) { const j = joueur(nom); j.va = va; j.vaSrc = src; j.maj = Date.now(); saveCfg(cfg); }
  // une VA estimée ne remplace jamais une VA exacte, mesurée ou saisie
  const RANG_VA = { exacte: 3, mesuree: 2, depart: 2, saisie: 2, estimee: 1 };
  const vaPlusSure = (j, src) => !j || j.va == null || (RANG_VA[src] || 0) >= (RANG_VA[j.vaSrc] || 0);
  const ficheDe = (nom) => (nom ? cfg.joueurs[String(nom).toLowerCase()] || null : null);
  const nivTxt = (j, k) => (j[k] == null ? '?' : j[k] + (j.sup && j.sup[k] ? '?' : ''));
  const resumePastilles = (j) => [['A', 'armes'], ['B', 'bouclier'], ['D', 'dome'], ['L', 'loge'], ['VA', 'va'], ['TdP', 'tdp']].map(([l, k]) => {
    const v = k === 'va' || k === 'tdp' ? (j[k] ?? '?') : nivTxt(j, k);
    return `<span class="pill${v === '?' ? ' inc' : String(v).endsWith('?') ? ' sup' : ''}"><i>${l}</i> ${esc(v)}</span>`;
  }).join('<span class="sep"> · </span>');
  const resumeFiche = (j) => `A ${nivTxt(j, 'armes')} · B ${nivTxt(j, 'bouclier')} · D ${nivTxt(j, 'dome')} · L ${nivTxt(j, 'loge')} · VA ${j.va ?? '?'} · TdP ${j.tdp ?? '?'}`;
  const ligneFiche = (j) => `${j.nom} // A:${nivTxt(j, 'armes')} // B:${nivTxt(j, 'bouclier')} // D:${nivTxt(j, 'dome')} // L:${nivTxt(j, 'loge')} // VA:${j.va ?? '?'} // TdP:${j.tdp ?? '?'}`;
  const dateCourte = (ms) => new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  /**
   * Joueur actif : mémorisé, affiché dans la barre, et recopié dans les autres onglets (sauf ceux de « sauf »).
   * Appelé quand on choisit une fiche, et quand un onglet vient de travailler sur un joueur.
   */
  function choisirFiche(nom, { sauf = [] } = {}) {
    const j = ficheDe(nom);
    if (!j) return;
    cfg.actif = j.nom; saveCfg(cfg);
    if (!LITE && !sauf.includes('sim')) remplirSimFiche(j);
    if (!sauf.includes('va') && ui.remplirVa) ui.remplirVa(j);
    majFiches();
  }
  /** Défenseur du simulateur d'après la fiche : dernière défense vue chez lui, ses niveaux (inconnus = 0). */
  function remplirSimFiche(j) {
    const s = lireSim();
    remplirSim({ def: j.defense ? j.defense.armee : {}, tech: { dB: j.bouclier ?? 0, dA: j.armes ?? 0, dC: 0 },
      lieu: { type: s.lieu.type, dome: j.dome ?? 0, loge: j.loge ?? 0 }, nom: j.nom });
  }
  /** Barre « Fiche », info du simulateur et onglet Joueurs. */
  function majFiches() {
    if (!panel) return;
    const js = Object.values(cfg.joueurs).sort((a, b) => (b.maj || 0) - (a.maj || 0));
    const dl = panel.querySelector('#c6p-fiches');
    if (dl) dl.innerHTML = js.map((j) => `<option value="${esc(j.nom)}">${esc(resumeFiche(j))}</option>`).join('');
    const j = ficheDe(cfg.actif);
    const inp = panel.querySelector('[data-fiche]');
    if (inp && racine.activeElement !== inp) inp.value = j ? j.nom : '';
    const res = panel.querySelector('[data-fres]');
    if (res) res.innerHTML = j ? resumePastilles(j) : '<span class="mut">aucun joueur choisi</span>';
    const sf = panel.querySelector('[data-simfiche]');
    if (sf) sf.innerHTML = ui.simNom && ficheDe(ui.simNom) ? `Défenseur : <b>${esc(ui.simNom)}</b>${ficheDe(ui.simNom).defense ? ` · armée vue le ${dateCourte(ficheDe(ui.simNom).defense.t)}` : ' · aucune défense connue'}` : '';
    if (ui.rendreJoueurs) ui.rendreJoueurs();
  }
  async function copier(texte, bouton) {
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(texte, 'text');
      else if (window.Android && typeof window.Android.copier === 'function') window.Android.copier(texte);
      else await navigator.clipboard.writeText(texte);
    }
    catch (e) { /* presse-papiers indisponible */ }
    if (bouton) { const o = bouton.textContent; bouton.textContent = '✓ Copié'; setTimeout(() => (bouton.textContent = o), 1500); }
  }

  const css = `
  :host{all:initial}
  /* ---- Palette C6P (brun et or) ---- */
  #c6prc,#c6prc-btn{--fond:#18120d;--carte:#221a13;--carte2:#2b2118;--champ:#110d09;--ligne:#3b2e21;--ligne2:#5a4630;
    --or:#f3d9a4;--bronze:#c08a45;--bronze2:#8a6a3b;--texte:#eee3d1;--mut:#a8997f;--ok:#8fd18f;--okf:#1f3a1d;--warn:#f0b35a;--warnf:#3a2a14;--ko:#ff8a6b;--kof:#3a1a14}
  #c6prc-btn{position:fixed;left:12px;bottom:12px;z-index:2147483646;background:var(--carte2);color:var(--or);border:1px solid var(--bronze2);border-radius:20px;padding:7px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 10px #0008}
  #c6prc{position:fixed;left:12px;bottom:52px;z-index:2147483647;width:min(600px,calc(100vw - 24px));max-height:calc(100vh - 70px);display:none;flex-direction:column;background:var(--fond);color:var(--texte);border:1px solid var(--bronze2);border-radius:12px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 30px #000b}
  #c6prc.open{display:flex}
  #c6prc.large{width:min(1000px,calc(100vw - 24px))}
  #c6prc{resize:both;overflow:hidden;min-width:320px;min-height:220px}
  #c6prc.flotte{bottom:auto}
  #c6prc.max{left:8px!important;top:8px!important;bottom:auto!important;width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important;max-height:none!important;resize:none}
  #c6prc.app{left:0!important;top:0!important;bottom:auto!important;width:100vw!important;height:100vh!important;height:100dvh!important;max-height:none!important;border:0;border-radius:0;resize:none;box-shadow:none;padding-top:env(safe-area-inset-top)}
  #c6prc.app input,#c6prc.app select,#c6prc.app textarea{font-size:16px}
  /* ---- En-tête et onglets ---- */
  #c6prc header{display:flex;justify-content:space-between;align-items:center;padding:9px 12px 4px;cursor:move;user-select:none}
  #c6prc header .titre{display:flex;align-items:baseline;gap:8px;font-weight:800;font-size:15px;color:var(--or);letter-spacing:.2px}
  #c6prc header .titre small{font-size:11px;font-weight:600;color:var(--mut)}
  #c6prc header .titre .ally{font-size:10px;font-weight:800;color:var(--fond);background:var(--bronze);border-radius:4px;padding:1px 5px}
  #c6prc.max header,#c6prc.app header{cursor:default}
  #c6prc header button{background:none;border:0;color:var(--texte);font-size:18px;cursor:pointer}
  #c6prc header .ctl{display:flex;gap:2px}
  #c6prc header .ctl button{width:28px;height:26px;border-radius:6px;font-size:15px;line-height:1}
  #c6prc header .ctl button:hover{background:var(--carte2)}
  #c6prc.app header .ctl,#c6prc.app [data-page]{display:none}
  #c6prc nav{display:flex;gap:4px;padding:4px 10px 0;border-bottom:1px solid var(--ligne)}
  #c6prc nav button{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;background:transparent;color:var(--mut);border:0;border-bottom:3px solid transparent;padding:8px 6px 7px;font:700 13px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
  #c6prc nav button .ico{font-size:15px}
  #c6prc nav button:hover{color:var(--texte)}
  #c6prc nav button.on{color:var(--or);border-bottom-color:var(--bronze)}
  @media (max-width:520px){#c6prc nav button{font-size:12px;padding:8px 2px 7px;gap:3px}#c6prc .long{display:none}}
  @media (min-width:521px){#c6prc .court{display:none}}
  /* ---- Barre « joueur actif » ---- */
  #c6prc .fbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;padding:7px 12px;border-bottom:1px solid var(--ligne);background:var(--carte);font-size:12px}
  #c6prc .fbar .lib{color:var(--mut);font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.5px}
  #c6prc .fbar input{width:150px!important;flex:none;font-weight:700}
  #c6prc .fbar [data-fres]{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:4px}
  #c6prc .pill{display:inline-flex;align-items:baseline;gap:3px;padding:1px 7px;border-radius:10px;background:var(--champ);border:1px solid var(--ligne);font-size:12px;white-space:nowrap}
  #c6prc .pill i{font-style:normal;color:var(--mut);font-size:10px;font-weight:700}
  #c6prc .pill.inc{color:var(--mut)}
  #c6prc .pill.sup{border-color:#6b4e22;color:var(--warn)}
  #c6prc .sep{display:none}
  @media (max-width:520px){#c6prc .fbar [data-fres]{flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto;gap:3px}#c6prc .fbar .pill{padding:1px 6px}}
  /* ---- Corps ---- */
  #c6prc .body{flex:1;min-height:0;overflow:auto;padding:10px 12px 16px}
  #c6prc .vue[hidden],#c6prc [data-vsec][hidden]{display:none}
  #c6prc .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
  #c6prc label{display:flex;gap:4px;align-items:center;font-size:12px;color:var(--mut)}
  #c6prc input[type=number],#c6prc input[type=text],#c6prc input[type=password],#c6prc select{width:64px;background:var(--champ);color:var(--texte);border:1px solid var(--ligne2);border-radius:6px;padding:4px 6px;font:13px system-ui,sans-serif;outline:none}
  #c6prc input[type=text]{width:110px}
  #c6prc input:focus,#c6prc select:focus,#c6prc textarea:focus{border-color:var(--bronze);box-shadow:0 0 0 2px #c08a4533}
  #c6prc textarea{width:100%;box-sizing:border-box;height:110px;background:var(--champ);color:var(--texte);border:1px solid var(--ligne2);border-radius:8px;padding:7px;font:12px ui-monospace,Consolas,monospace;outline:none}
  #c6prc .b{display:inline-flex;align-items:center;gap:5px;background:var(--bronze);color:#1a120a;border:0;border-radius:8px;padding:7px 14px;font:700 13px system-ui,sans-serif;cursor:pointer}
  #c6prc .b:hover{filter:brightness(1.08)}
  #c6prc .b:disabled{opacity:.55;cursor:wait}
  #c6prc .b.alt{background:var(--carte2);color:var(--texte);border:1px solid var(--ligne2)}
  #c6prc .b.mini{padding:3px 9px;font-size:12px;border-radius:6px}
  /* ---- Cartes ---- */
  #c6prc .card{border:1px solid var(--ligne);border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--carte)}
  #c6prc h4{margin:0 0 6px;color:var(--or);font-size:14px;font-weight:800}
  #c6prc .card>h4:first-child{display:flex;align-items:center;gap:6px}
  #c6prc .sous{margin:-2px 0 8px;color:var(--mut);font-size:12px}
  #c6prc table{border-collapse:collapse;width:100%;font-size:12.5px}
  #c6prc td,#c6prc th{padding:4px 6px;border-bottom:1px solid var(--ligne);text-align:left;vertical-align:top}
  #c6prc th{color:var(--mut);font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:.3px}
  #c6prc .ok{color:var(--ok)}#c6prc .warn{color:var(--warn)}#c6prc .mut{color:var(--mut)}
  #c6prc .big{font-weight:800;color:#fff}
  #c6prc .warn.big{color:var(--warn)}#c6prc .ok.big{color:var(--ok)}
  /* ---- Messages (encadrés) et aide repliable ---- */
  #c6prc .note{margin:6px 0;padding:7px 10px;border-radius:8px;border-left:3px solid var(--ligne2);background:var(--carte2);font-size:13px}
  #c6prc .note.ok{border-left-color:var(--ok);background:var(--okf);color:var(--texte)}
  #c6prc .note.warn{border-left-color:var(--warn);background:var(--warnf);color:var(--texte)}
  #c6prc .note.ko{border-left-color:var(--ko);background:var(--kof);color:var(--texte)}
  #c6prc .note.ok b,#c6prc .note.ok strong{color:var(--ok)}#c6prc .note.warn b{color:var(--warn)}
  #c6prc details.aide{margin:8px 0 0;border-top:1px dashed var(--ligne);padding-top:6px}
  #c6prc details.aide>summary{cursor:pointer;color:var(--mut);font-size:12px;list-style:none}
  #c6prc details.aide>summary::-webkit-details-marker{display:none}
  #c6prc details.aide>summary::before{content:"ℹ️ "}
  #c6prc details.aide[open]>summary{color:var(--texte)}
  #c6prc details.aide>div,#c6prc details.aide>p{color:var(--mut);font-size:12px;margin:6px 0 0}
  #c6prc details.det>summary{cursor:pointer;color:var(--or);font-weight:700;font-size:13px;margin:8px 0 4px}
  /* ---- Résultat principal ---- */
  #c6prc .hero{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin:8px 0 4px}
  #c6prc .va-res{font-size:28px;line-height:1.1;font-weight:900;color:var(--ok);margin:4px 0;letter-spacing:.3px}
  #c6prc .hero .va-res{margin:0}
  #c6prc .badge{display:inline-block;font-size:11px;font-weight:800;padding:2px 9px;border-radius:10px;text-transform:uppercase;letter-spacing:.4px;background:var(--carte2);color:var(--mut);border:1px solid var(--ligne2)}
  #c6prc .badge.ok{background:var(--okf);color:var(--ok);border-color:#2f5a2c}
  #c6prc .badge.warn{background:var(--warnf);color:var(--warn);border-color:#6b4e22}
  #c6prc .badge.ko{background:var(--kof);color:var(--ko);border-color:#6b2e22}
  #c6prc .pourquoi{color:var(--texte);font-size:13px;margin:2px 0 6px}
  /* ---- Sous-onglets (segments) ---- */
  #c6prc .seg{display:flex;gap:4px;padding:4px;background:var(--carte);border:1px solid var(--ligne);border-radius:10px;margin:2px 0 10px}
  #c6prc .seg button{flex:1;background:transparent;color:var(--mut);border:0;border-radius:7px;padding:7px 6px;font:700 12.5px system-ui,sans-serif;cursor:pointer}
  #c6prc .seg button.on{background:var(--bronze);color:#1a120a}
  #c6prc .seg button:not(.on):hover{color:var(--texte);background:var(--carte2)}
  /* ---- Analyse RC ---- */
  #c6prc .reglages{border:1px solid var(--ligne);border-radius:10px;background:var(--carte);margin-bottom:10px}
  #c6prc .reglages>summary{list-style:none;display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;font-weight:800;color:var(--or)}
  #c6prc .reglages>summary::-webkit-details-marker{display:none}
  #c6prc .reglages>summary{white-space:nowrap}
  #c6prc .reglages>summary .res{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:600;color:var(--mut);font-size:12px;text-align:right}
  #c6prc label.case{display:block;line-height:1.5}
  #c6prc .reglages>summary .chev,#c6prc .armybox .chev{transition:transform .15s;color:var(--mut)}
  #c6prc .reglages[open]>summary .chev,#c6prc .armybox[open] .chev{transform:rotate(180deg)}
  #c6prc .reglages .in{padding:0 12px 10px}
  #c6prc .xpsel{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:12px}
  #c6prc .xpsel>span{margin-right:4px;color:var(--mut)}
  #c6prc .chip{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border:1px solid var(--ligne2);border-radius:12px;background:var(--champ);color:var(--texte);cursor:pointer;user-select:none}
  #c6prc .chip:has(input:checked){background:var(--bronze);color:#1a120a;border-color:var(--bronze);font-weight:800}
  #c6prc .chip input{margin:0;accent-color:#1a120a}
  #c6prc .armybox{margin-top:8px;border:1px solid var(--ligne);border-radius:10px;background:var(--carte)}
  #c6prc .armybox summary{list-style:none;display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;color:var(--or);font-weight:800}
  #c6prc .armybox summary::-webkit-details-marker{display:none}
  #c6prc .armybox summary:hover,#c6prc .reglages>summary:hover{background:var(--carte2);border-radius:10px}
  #c6prc .armybox .ico{font-size:16px}
  #c6prc .armybox .badge{margin-left:auto;text-transform:none;letter-spacing:0;background:var(--warnf);color:var(--warn);border-color:#6b4e22}
  #c6prc .armybox .badge.on{background:var(--okf);color:var(--ok);border-color:#2f5a2c}
  #c6prc .armybox textarea,#c6prc .armybox [data-armyread]{margin:0 12px 10px;width:calc(100% - 24px)}
  #c6prc .alertes{margin-top:8px;padding:7px 10px;border-left:3px solid var(--warn);background:var(--warnf);border-radius:8px;font-size:12.5px}
  #c6prc .alertes div{margin:3px 0}
  #c6prc pre.copie{white-space:pre-wrap;background:var(--champ);border:1px solid var(--ligne);border-radius:8px;padding:7px 9px;font:12px ui-monospace,Consolas,monospace;margin:6px 0;color:var(--or)}
  #c6prc .niv{display:inline-block;min-width:26px;text-align:center;padding:1px 6px;border-radius:6px;font-weight:800}
  #c6prc .niv.ok{background:var(--okf)}#c6prc .niv.warn{background:var(--warnf)}
  /* ---- Simulateur : mise en page du simulateur du jeu ---- */
  #c6prc .sim{background:#d6c38c;color:#1b1307;border-radius:6px;padding:10px;font-family:Arial,sans-serif}
  #c6prc .sim fieldset{border:1px solid #3d2e14;border-radius:2px;padding:6px 10px;margin:0 0 10px;background:#d6c38c}
  #c6prc .sim legend{color:#c40000;font:italic 700 20px Georgia,serif;padding:0 4px}
  #c6prc .sim legend small{color:#1b1307;font:12px Arial,sans-serif}
  #c6prc .sim legend small a{color:#1b1307;cursor:pointer;text-decoration:none}
  #c6prc .sim legend small a.on{font-weight:700;text-decoration:underline}
  #c6prc .sim .grille{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:14px}
  #c6prc .sim table{font-size:13px}
  #c6prc .sim td,#c6prc .sim th{border:0;padding:2px 3px;vertical-align:middle;color:#1b1307}
  #c6prc .sim th{font-weight:700;text-align:center;text-transform:none;letter-spacing:0;font-size:13px}
  #c6prc .sim input.n{width:100%;box-sizing:border-box;background:#fff;color:#000;border:1px solid #7a6a4a;border-radius:0;padding:2px 4px;text-align:right;font:13px Arial,sans-serif}
  #c6prc .sim input.lv{width:52px;background:#fff;color:#000;border:1px solid #7a6a4a;border-radius:0;padding:2px 4px;text-align:right;font:13px Arial,sans-serif}
  #c6prc .sim .nom{text-align:center;white-space:nowrap}
  #c6prc .sim .fl{cursor:pointer;font-weight:700;user-select:none;padding:0 2px}
  #c6prc .sim .tot td{text-align:right;font-size:13px}
  #c6prc .sim .tot td.c{text-align:center}
  #c6prc .sim label{font-size:14px;color:#1b1307;margin:3px 0}
  #c6prc .sim .fight{display:block;width:100%;padding:4px;margin:4px 0 10px;background:#f2f2f2;color:#000;border:1px solid #888;border-radius:2px;font:13px Arial,sans-serif;cursor:pointer}
  #c6prc .sim .fight:hover{background:#fff}
  #c6prc .sim .rac button{font:12px Arial,sans-serif;margin:2px 0;width:100%;background:#efe3bd;border:1px solid #7a6a4a;border-radius:2px;cursor:pointer;padding:3px}
  #c6prc .sim h3{color:#c40000;font:italic 700 22px Georgia,serif;text-align:center;margin:6px 0}
  #c6prc .sim .msg{white-space:pre-wrap;font:14px/1.35 Arial,sans-serif;color:#1b1307}
  #c6prc .sim .msg b{font-weight:700}
  #c6prc .sim .act{display:flex;gap:6px;justify-content:center;margin-top:8px}
  #c6prc .sim .colle{cursor:pointer;font-size:14px;vertical-align:middle}
  #c6prc .sim .collebox{background:#e8d9a8;border:1px solid #7a6a4a;border-radius:2px;padding:6px 8px;margin-top:6px;font-size:13px}
  #c6prc .sim .collebox textarea{display:block;width:100%;box-sizing:border-box;height:80px;margin:4px 0;background:#fff;color:#000;border:1px solid #7a6a4a;border-radius:0;font:13px Arial,sans-serif;padding:3px}
  #c6prc .sim .collebox [data-collemsg]{color:#c40000;margin-top:4px}
  #c6prc .sim .act button{font:12px Arial,sans-serif;background:#efe3bd;border:1px solid #7a6a4a;border-radius:2px;cursor:pointer;padding:3px 10px}
  @media (max-width:760px){#c6prc .sim .grille{grid-template-columns:1fr}}
  /* ---- Fiches joueurs ---- */
  #c6prc .fi-tab tr{cursor:pointer}
  #c6prc .fi-tab tr:hover td{background:var(--carte2)}
  #c6prc .fi-tab tr.on td{background:var(--okf)}
  #c6prc .fi-tab td{vertical-align:middle}
  #c6prc .fi-tab .nomf{font-weight:800;color:var(--or);cursor:pointer}
  #c6prc .fi-edit input,#c6prc .fi-edit select{width:100%!important;box-sizing:border-box}
  #c6prc [data-simfiche]{font:13px system-ui,sans-serif;color:#3d2e14;margin:0 0 6px}
  #c6prc [data-simfiche]:not(:empty){background:#e8d9a8;border:1px solid #b39a5c;border-radius:6px;padding:4px 8px}
  /* ---- VA & TdP ---- */
  #c6prc .grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 12px}
  #c6prc .grid2 label{flex-direction:column;align-items:stretch;gap:3px}
  #c6prc .grid2 input,#c6prc .grid2 select{width:100%!important;box-sizing:border-box}
  #c6prc .cibles{margin-top:12px;padding-top:10px;border-top:1px dashed var(--ligne2)}
  #c6prc .cb-tete{background:var(--champ);border:1px solid var(--ligne);border-radius:8px;padding:8px 10px;margin:8px 0}
  #c6prc .cb-ally{background:var(--carte2);border:1px solid var(--bronze2);border-radius:4px;padding:0 5px;font-size:11px;font-weight:800;color:var(--or)}
  #c6prc .cb-grp{border:1px solid var(--ligne);border-radius:10px;margin:8px 0;overflow:hidden;background:var(--fond)}
  #c6prc .cb-grp.nous{border-color:#a0442c}
  #c6prc .cb-grp-h{display:flex;align-items:center;gap:6px;padding:7px 10px;font-weight:800;color:var(--or);background:var(--carte2)}
  #c6prc .cb-grp.nous .cb-grp-h{background:#3a1d14;color:#ffb59c}
  #c6prc .cb-n{margin-left:auto;background:var(--bronze);color:#1a120a;border-radius:10px;padding:0 8px;font-size:12px}
  #c6prc .cb-grp.nous .cb-n{background:#d0603e;color:#fff}
  #c6prc .cb-tab td{vertical-align:middle}
  #c6prc .cb-tab tr.past td{opacity:.5}
  #c6prc .cb-tag{font-size:10px;font-weight:800;border-radius:4px;padding:0 4px;margin-left:3px}
  #c6prc .cb-tag.lim{background:var(--warnf);color:var(--warn)}
  #c6prc .cb-tag.ina{background:var(--carte2);color:var(--mut)}
  #c6prc .cb-eta{display:inline-block;white-space:nowrap;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:800;background:var(--carte2);color:#c9b99c}
  #c6prc .cb-eta.urgent{background:#a0442c;color:#fff}
  #c6prc .cb-eta.proche{background:#7a5a1e;color:#ffe3a8}
  #c6prc .cb-eta.loin{background:#2f4a2a;color:#bfe8bf}
  #c6prc .cb-lance{font-size:15px;color:var(--ok)}
  #c6prc .cb-mode{display:flex;gap:4px;margin-top:8px;padding:4px;background:var(--carte);border:1px solid var(--ligne);border-radius:10px}
  #c6prc .cb-mode button{flex:1;background:transparent;color:var(--mut);border:0;border-radius:7px;padding:6px 8px;font-weight:700;cursor:pointer}
  #c6prc .cb-mode button.on{background:var(--bronze);color:#1a120a}
  #c6prc .cb-tab tr.urgent .cb-lance{color:var(--ko)}
  #c6prc .depart-card{border-color:var(--bronze2)}
  #c6prc .depart-card .va-res{font-size:22px}
  #c6prc .barre-va{display:inline-block;height:9px;background:var(--bronze);border-radius:3px;vertical-align:middle}
  #c6prc tr.choisie td{color:#fff;font-weight:800}
  `;

  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  let panel, ui = {};

  /* Discrétion : tout vit dans un Shadow DOM fermé, inséré seulement à l'ouverture et retiré à la fermeture.
   * Le site ne voit qu'un élément <div> sans attribut ; il ne peut lire ni son contenu ni ses styles. */
  let hote = null, racine = null, montage = null;
  function monter() {
    if (hote) return;
    hote = document.createElement('div');
    racine = hote.attachShadow({ mode: 'closed' });
    montage = new AbortController();
    (document.body || document.documentElement).appendChild(hote);
    init();
  }
  function demonter() {
    if (!hote) return;
    montage.abort(); hote.remove();
    hote = racine = panel = null; ui = {};
  }
  const estOuvert = () => !!(panel && panel.classList.contains('open'));
  function ouvrir() { monter(); panel.classList.add('open'); cfg.ouvert = true; saveCfg(cfg); }
  function fermer() { cfg.ouvert = false; saveCfg(cfg); if (cfg.bouton) { if (panel) panel.classList.remove('open'); } else demonter(); }
  const basculer = () => (estOuvert() ? fermer() : ouvrir());

  function init() {
    const st = document.createElement('style'); st.textContent = css; racine.appendChild(st);
    const btn = el('<button id="c6prc-btn" type="button">⚔️ SimuOpti</button>');
    panel = el(`<div id="c6prc">
      <header><span class="titre">⚔️ SimuOpti <small>v${VERSION}</small></span><span class="ctl">
        <button type="button" data-reset title="Remettre en place (position et taille d'origine)">⟲</button>
        <button type="button" data-max title="Agrandir en plein écran">⤢</button>
        <button type="button" data-x title="Fermer">×</button></span></header>
      <nav>${[['rc', '📜', 'Analyse RC', 'RC'], ['sim', '⚔️', 'Simulateur', 'Simu'], ['va', '🐜', 'VA &amp; TdP', 'VA·TdP'], ['fiches', '📇', 'Joueurs', 'Joueurs']].filter(([k]) => !LITE || k !== 'sim').map(([k, i, l, c]) => `<button type="button" data-tab="${k}"><span class="ico">${i}</span><span class="long">${l}</span><span class="court">${c}</span></button>`).join('')}</nav>
      <div class="fbar" title="Joueur actif : sa fiche remplit les autres onglets"><span class="lib">📇 Joueur actif</span><input type="text" data-fiche list="c6p-fiches" placeholder="Choisir un joueur…" autocomplete="off"><datalist id="c6p-fiches"></datalist><span class="mut" data-fres></span></div>
      <div class="body">
        <section class="vue" data-vue="rc">${vueRc()}</section>
        ${LITE ? '' : `<section class="vue" data-vue="sim">${vueSim()}</section>`}
        <section class="vue" data-vue="va">${vueVa()}</section>
        <section class="vue" data-vue="fiches">${vueFiches()}</section>
      </div></div>`);
    if (cfg.bouton) racine.append(btn);
    racine.append(panel);
    btn.onclick = basculer;
    panel.querySelector('[data-x]').onclick = fermer;
    panel.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => onglet(b.dataset.tab)));
    if (APP) panel.classList.add('app', 'open'); else fenetre();
    initRc(); if (!LITE) initSim(); initVa(); initFiches();
    onglet(cfg.onglet || 'rc');
  }
  /* Fenêtre flottante : déplacer par la barre de titre, redimensionner par le coin, plein écran. Tout est mémorisé. */
  function fenetre() {
    const head = panel.querySelector('header');
    const bMax = panel.querySelector('[data-max]');
    const borne = (x, y) => {
      const r = panel.getBoundingClientRect();
      return [Math.min(Math.max(0, x), Math.max(0, innerWidth - Math.min(r.width, innerWidth) )), Math.min(Math.max(0, y), Math.max(0, innerHeight - 40))];
    };
    const placer = () => {
      if (cfg.fenPos) { const [x, y] = borne(cfg.fenPos.x, cfg.fenPos.y); panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.classList.add('flotte'); }
      else { panel.style.left = ''; panel.style.top = ''; panel.classList.remove('flotte'); }
      if (cfg.fenTaille) { panel.style.width = cfg.fenTaille.w + 'px'; panel.style.height = cfg.fenTaille.h + 'px'; panel.style.maxHeight = 'calc(100vh - 16px)'; }
      else { panel.style.width = ''; panel.style.height = ''; panel.style.maxHeight = ''; }
    };
    const setMax = (m) => { panel.classList.toggle('max', m); bMax.textContent = m ? '❐' : '⤢'; bMax.title = m ? 'Réduire' : 'Agrandir en plein écran'; cfg.fenMax = m; saveCfg(cfg); };
    // déplacement
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || panel.classList.contains('max') || e.button !== 0) return;
      const r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px'; panel.classList.add('flotte');
      head.setPointerCapture(e.pointerId);
      const move = (ev) => { const [x, y] = borne(ev.clientX - dx, ev.clientY - dy); panel.style.left = x + 'px'; panel.style.top = y + 'px'; };
      const up = () => {
        head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
        cfg.fenPos = { x: parseFloat(panel.style.left) || 0, y: parseFloat(panel.style.top) || 0 }; saveCfg(cfg);
      };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) setMax(!panel.classList.contains('max')); });
    // redimensionnement (coin bas-droit) : on mémorise la taille choisie
    let premier = true;
    new ResizeObserver(() => {
      if (premier) { premier = false; return; }
      if (panel.classList.contains('max') || !panel.classList.contains('open') || !panel._resizing) return;
      const r = panel.getBoundingClientRect();
      cfg.fenTaille = { w: Math.round(r.width), h: Math.round(r.height) }; saveCfg(cfg);
    }).observe(panel);
    // seul un redimensionnement fait à la main est mémorisé (pas les changements d'onglet)
    panel.addEventListener('pointerdown', (e) => {
      const r = panel.getBoundingClientRect();
      panel._resizing = e.clientX > r.right - 18 && e.clientY > r.bottom - 18;
    });
    addEventListener('pointerup', () => setTimeout(() => { if (panel) panel._resizing = false; }, 50), { signal: montage.signal });
    bMax.onclick = () => setMax(!panel.classList.contains('max'));
    panel.querySelector('[data-reset]').onclick = () => { delete cfg.fenPos; delete cfg.fenTaille; setMax(false); placer(); };
    addEventListener('resize', () => { if (cfg.fenPos && panel) placer(); }, { signal: montage.signal });
    placer();
    if (cfg.fenMax) setMax(true);
  }

  function onglet(id) {
    if (LITE && id === 'sim') id = 'rc';
    cfg.onglet = id; saveCfg(cfg);
    panel.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    panel.querySelectorAll('[data-vue]').forEach((v) => (v.hidden = v.dataset.vue !== id));
    panel.classList.toggle('large', id === 'sim' && !cfg.fenTaille);
  }

  /* ============================ Onglet Analyse RC ============================ */
  function vueRc() {
    return `
      <details class="reglages" data-reglages><summary>⚙️ Mes niveaux <span class="res" data-regres></span><span class="chev">▼</span></summary><div class="in">
        <div class="grid2">
          <label>Pseudo <input type="text" data-k="pseudo"></label>
          <label>Armes <input type="number" min="0" max="60" data-k="armes"></label>
          <label>Bouclier <input type="number" min="0" max="60" data-k="bouclier"></label>
          <label>Cochenille <input type="number" min="0" max="60" data-k="cochenille"></label>
          <label title="Marge ajoutée au minimum de JSN tampon">Marge tampon (%) <input type="number" min="0" max="500" step="1" data-k="tampon"></label>
        </div>
        <div class="row"><div class="xpsel"><span>Unités à faire évoluer</span>${Object.keys(Core.EVOL).map((u) => `<label class="chip"><input type="checkbox" data-xp="${u}">${L(u)}</label>`).join('')}</div></div>
      </div></details>
      <h4>📜 Rapports de combat</h4>
      <textarea data-rc placeholder="Colle un ou plusieurs rapports de combat ici…"></textarea>
      <details data-armybox class="armybox"><summary><span class="ico">🐜</span><span>Mon armée <span class="mut">— pour calculer l’envoi optimal</span></span><span class="badge" data-armybadge>vide</span><span class="chev">▼</span></summary>
        <textarea data-army style="height:80px;margin-top:4px" placeholder="Colle ton armée disponible : « Copier l'armée » d'un rapport, ou la liste de la page Armée (une unité par ligne)…"></textarea>
        <div class="mut" data-armyread></div>
      </details>
      <div class="row">
        <button class="b" type="button" data-go>🔍 Analyser</button>
        <button class="b alt" type="button" data-page>📄 Analyser la page</button>
        <button class="b alt" type="button" data-clear>✖ Effacer</button>
      </div>
      <div data-out></div>`;
  }
  function initRc() {
    const v = panel.querySelector('[data-vue="rc"]');
    const ta = v.querySelector('[data-rc]'), out = v.querySelector('[data-out]');
    ui.rcTa = ta; ui.rcOut = out;
    const taArmy = v.querySelector('[data-army]'), armyRead = v.querySelector('[data-armyread]');
    const rerender = () => { if (ta.value.trim()) render(ta.value, out); };
    const showArmy = () => {
      const a = Core.parseArmyLoose(taArmy.value);
      armyRead.textContent = a.length ? 'Lu : ' + armyStr(a) : (taArmy.value.trim() ? 'Aucune unité reconnue.' : '');
      const badge = v.querySelector('[data-armybadge]');
      badge.textContent = a.length ? `${a.length} type${a.length > 1 ? 's' : ''} d’unités` : 'vide — clique pour remplir';
      badge.classList.toggle('on', a.length > 0);
    };
    taArmy.value = cfg.armee || '';
    if (cfg.armee) v.querySelector('[data-armybox]').open = true;
    showArmy();
    taArmy.addEventListener('input', () => {
      cfg.armee = taArmy.value; saveCfg(cfg); showArmy();
      clearTimeout(taArmy._t); taArmy._t = setTimeout(rerender, 400);
    });
    if (!Array.isArray(cfg.xpUnits)) cfg.xpUnits = [cfg.unit || 'T'];
    v.querySelectorAll('[data-xp]').forEach((cb) => {
      cb.checked = cfg.xpUnits.includes(cb.dataset.xp);
      cb.addEventListener('change', () => { cfg.xpUnits = [...v.querySelectorAll('[data-xp]:checked')].map((x) => x.dataset.xp); saveCfg(cfg); rerender(); });
    });
    v.querySelectorAll('[data-k]').forEach((inp) => {
      inp.value = cfg[inp.dataset.k] ?? '';
      inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        cfg[k] = inp.type === 'number' ? (parseFloat(inp.value) || 0) : inp.value.trim();
        saveCfg(cfg); rerender(); majReglages();
      });
    });
    // résumé des réglages sur le bloc replié ; ouvert tant que rien n'est réglé
    const majReglages = () => {
      v.querySelector('[data-regres]').textContent = `${cfg.pseudo || 'pseudo ?'} · Armes ${cfg.armes || 0} · Bouclier ${cfg.bouclier || 0} · Cochenille ${cfg.cochenille || 0} · ${(cfg.xpUnits || []).map(L).join(' + ') || 'aucune unité'}`;
    };
    majReglages();
    if (!cfg.armes && !cfg.pseudo) v.querySelector('[data-reglages]').open = true;
    v.querySelectorAll('[data-xp]').forEach((cb) => cb.addEventListener('change', majReglages));
    const keepRc = () => { cfg.rapport = ta.value; saveCfg(cfg); };
    v.querySelector('[data-go]').onclick = () => { keepRc(); render(ta.value, out, { choisir: true }); };
    v.querySelector('[data-clear]').onclick = () => { ta.value = ''; out.innerHTML = ''; keepRc(); };
    v.querySelector('[data-page]').onclick = () => { ta.value = document.body.innerText; keepRc(); render(ta.value, out, { choisir: true }); };
    ta.addEventListener('input', keepRc);
    // délégation : copie des niveaux, envoi vers le simulateur
    out.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.copy != null) copier(ui.copieTexte || '', b);
      if (b.dataset.copiearmee != null) copier(b.dataset.copiearmee, b);
      if (b.dataset.tosim != null && ui.simPrep && ui.simPrep[b.dataset.tosim]) { const sp = ui.simPrep[b.dataset.tosim]; remplirSim(sp); if (sp.nom) choisirFiche(sp.nom, { sauf: ['sim'] }); onglet('sim'); }
    });
    if (cfg.rapport) { ta.value = cfg.rapport; try { render(ta.value, out); } catch (e) { /* rapport illisible */ } }
  }

  /** Ligne « pseudo // A:x // B:x // D:x // L:x // VA:x // TdP:x » ; « ? » = inconnu, « 18? » = supposé */
  function ligneJoueur(p) {
    const pick = (pl) => {
      const r = p.res[pl];
      if (!r) return { v: '-', sup: false };
      if (r.combos.length === 1) return { v: r.combos[0].niveau, b: r.combos[0].bouclier, sup: false };
      if (r.hyp) return { v: r.hyp.niveau + '?', b: r.hyp.bouclier, sup: true };
      return { v: '?', sup: false };
    };
    const d = pick('dome'), l = pick('loge');
    let b = p.bouclierLvl != null ? String(p.bouclierLvl) : null;
    if (b == null) { const h = [d, l].find((x) => x.b != null); b = h ? h.b + (h.sup ? '?' : '') : '?'; }
    const j = cfg.joueurs[p.name.toLowerCase()] || {};
    const va = j.va != null ? j.va : '?', tp = j.tdp != null ? j.tdp : '?';
    return `${p.name} // A:${p.armesLvl ?? '?'} // B:${b} // D:${d.v} // L:${l.v} // VA:${va} // TdP:${tp}`;
  }

  /** Fiches d'après une analyse : niveaux de chaque joueur (sauf moi) et dernière défense vue chez lui. */
  function noterAnalyse(res, text, me) {
    const dateTexte = Core.dateRc(text);
    const autres = res.players.filter((p) => p.name && !memeNom(p.name, me) && p.name !== 'Moi');
    for (const p of autres) {
      const lieu = (pl) => { const r = p.res[pl]; if (!r) return null; if (r.combos.length === 1) return { v: r.combos[0].niveau, b: r.combos[0].bouclier }; return r.hyp ? { v: r.hyp.niveau, b: r.hyp.bouclier, sup: true } : null; };
      const d = lieu('dome'), l = lieu('loge'), b = [d, l].find((x) => x && x.b != null);
      noterNiveaux(p.name, { armes: p.armesLvl != null ? { v: p.armesLvl } : null,
        bouclier: p.bouclierLvl != null ? { v: p.bouclierLvl } : b ? { v: b.b, sup: b.sup } : null, dome: d, loge: l }, dateTexte);
    }
    for (const r of res.analyses) {
      const dn = (r.combat.header || {}).def;
      if (!dn || memeNom(dn, me)) continue;
      const j = joueur(dn), t = r.combat.date || dateTexte || Date.now();
      if (!j.defense || t >= j.defense.t) j.defense = { armee: Object.fromEntries(r.combat.defenders), t };
      j.maj = Date.now();
    }
    saveCfg(cfg);
    return autres;
  }

  function render(text, out, { choisir = false } = {}) {
    const res = Core.analyseText(text, cfg);
    if (!res.analyses.length) { out.innerHTML = '<p class="warn">Aucun combat reconnu dans ce texte.</p>'; return; }
    const me = cfg.pseudo || 'Moi';
    const adversaires = noterAnalyse(res, text, me);
    // un seul adversaire dans les rapports : il devient le joueur actif (sa fiche remplit les autres onglets)
    if (choisir && adversaires.length === 1) setTimeout(() => choisirFiche(adversaires[0].name), 0);
    else majFiches();
    let html = '';
    ui.simPrep = [];

    // ---- Synthèse par joueur
    const alertes = [];
    const exact = (v) => `<span class="niv ok">${v}</span>`;
    const suppose = (v) => `<span class="niv warn">≈${v}</span>`;
    const vide = '<span class="mut">—</span>';
    html += '<div class="card"><h4>📊 Niveaux par joueur</h4><table><tr><th>Joueur</th><th>Armes</th><th>Bouclier</th><th>Dôme</th><th>Loge</th><th>Vie</th></tr>';
    for (const p of res.players) {
      const nom = esc(p.name);
      let bouclier = p.bouclierLvl != null ? exact(p.bouclierLvl) : null;
      const vies = [];
      const lieu = (pl) => {
        const r = p.res[pl];
        if (!r) { const pf = p.plafonds[pl]; if (pf.length) vies.push(`${LIEU[pl]} ≤ ×${f2(Math.min(...pf))}`); return vide; }
        vies.push(`${LIEU[pl]} ×${f2(r.mult)}`);
        if (r.combos.length === 1) return exact(r.combos[0].niveau);
        if (r.cands) alertes.push(`${nom} (${LIEU[pl]}) : trop peu de tués, vie entre ×${f2(r.cands[0])} et ×${f2(r.cands[r.cands.length - 1])}. La valeur haute est retenue.`);
        if (!r.combos.length) { alertes.push(`${nom} (${LIEU[pl]}) : vie ×${f2(r.mult)} sans combinaison bouclier/niveau cohérente, rapport à vérifier.`); return '<span class="warn">?</span>'; }
        const a = r.combos[0], b = r.combos[r.combos.length - 1];
        if (r.hyp) {
          if (bouclier == null) bouclier = suppose(r.hyp.bouclier);
          alertes.push(`${nom} (${LIEU[pl]}) : bouclier et niveau supposés (plus haut bouclier ≤ armes). ${r.combos.length} combinaisons possibles, de bouclier ${a.bouclier} / niveau ${a.niveau} à bouclier ${b.bouclier} / niveau ${b.niveau}.`);
          return suppose(r.hyp.niveau);
        }
        alertes.push(`${nom} (${LIEU[pl]}) : ${r.combos.length} combinaisons possibles, de bouclier ${a.bouclier} / niveau ${a.niveau} à bouclier ${b.bouclier} / niveau ${b.niveau}.`);
        return '<span class="warn">?</span>';
      };
      const dome = lieu('dome'), loge = lieu('loge');
      if (bouclier == null) bouclier = '<span class="mut">?</span>';
      html += `<tr><td>${nom}</td><td>${p.armesLvl ?? '—'}</td><td>${bouclier}</td><td>${dome}</td><td>${loge}</td><td class="mut">${vies.join('<br>') || '—'}</td></tr>`;
    }
    html += '</table>';
    const meP = res.players.find((p) => p.name.toLowerCase() === me.toLowerCase());
    if (meP && meP.bouclierLvl == null && !cfg.bouclier) alertes.unshift(`Ton bouclier n’est pas lisible dans ces rapports : le calcul suppose bouclier ${res.my.bouclier} (= tes armes). Renseigne-le dans les réglages, il fixe le nombre de JSN tampon.`);
    html += `<div class="mut" style="margin-top:6px"><span class="niv ok">vert</span> calculé · <span class="niv warn">≈ orange</span> supposé</div>`;
    if (alertes.length) html += `<div class="alertes">${alertes.map((a) => `<div class="warn">⚠ ${a}</div>`).join('')}</div>`;
    // copie au format « pseudo // A // B // D // L // VA // TdP »
    const autres = res.players.filter((p) => p.name.toLowerCase() !== me.toLowerCase());
    ui.copieTexte = (autres.length ? autres : res.players).map(ligneJoueur).join('\n');
    html += `<div class="row" style="margin-top:8px"><button class="b mini" type="button" data-copy>📋 Copier les niveaux</button><span class="mut">« ? » = inconnu · « 18? » = supposé · VA et TdP viennent de l’onglet VA &amp; TdP</span></div>
      <pre class="copie">${esc(ui.copieTexte)}</pre>`;
    html += '</div>';

    // ---- Détail des combats
    res.analyses.forEach((r, i) => {
      const h = r.combat.header || {};
      const an = h.att || me, dn = h.def || me;
      const place = h.place;
      html += `<div class="card"><h4>⚔️ #${i + 1} ${esc(an)} → ${esc(dn)} ${place ? '· ' + LIEU[place] : ''} ${h.colonie ? '(colonie)' : ''}</h4>`;
      html += `<div class="mut">Attaque : ${armyStr(r.combat.attackers)}<br>Défense : ${armyStr(r.combat.defenders)}</div>`;
      html += '<table><tr><th>Tour</th><th>Vie défenseur</th><th>Vie attaquant</th></tr>';
      for (const rd of r.rounds) {
        const v = (m, all) => (m == null ? '—' : all ? `<span class="mut">≤ ×${f2(m)} (tous tués)</span>` : `×${f2(m)}`);
        const vd = rd.candsDef && rd.candsDef.length > 1 ? `<span class="warn">×${f2(rd.candsDef[0])} à ×${f2(rd.candsDef[rd.candsDef.length - 1])}</span>` : v(rd.multDef, rd.allDef);
        html += `<tr><td>${rd.n}</td><td>${vd}</td><td>${v(rd.multAtt, rd.allAtt)}</td></tr>`;
      }
      html += '</table>';
      html += `<div>Armes : ${esc(an)} <b>${r.attArmes ?? '—'}</b> · ${esc(dn)} <b>${r.defArmes ?? '—'}</b>`;
      if (r.attMult) html += ` · Bouclier ${esc(an)} <b>${Math.round((r.attMult - 1) * 10)}</b>`;
      html += '</div>';
      if (r.oneShot) html += `<div class="${r.facteurReplique === 0.1 ? 'ok' : 'warn'}">One-shot : réplique ×${r.facteurReplique ?? '?'}.</div>`;
      if (r.xpMult) {
        if (r.xpMult.full) html += '<div class="mut">XP à 100 % : la vie exacte n’est pas lisible, seulement un plafond.</div>';
        else html += `<div class="ok">XP ${f2(r.xpMult.pct)} % → vie réelle du défenseur ×${f2(r.xpMult.mult)} (cochenille ${cfg.cochenille}).</div>`;
      }
      r.warn.forEach((w) => (html += `<div class="warn">⚠ ${esc(w)}</div>`));

      // ---- Plan one-shot contre le défenseur de ce rapport
      const eMult = r.defMult || (r.xpMult && !r.xpMult.full ? r.xpMult.mult : null) || r.defPlafond;
      if (eMult && r.defArmes != null) {
        const exactV = !!(r.defMult || (r.xpMult && !r.xpMult.full));
        const cibles = (cfg.xpUnits && cfg.xpUnits.length) ? cfg.xpUnits : ['T'];
        const frappeurs = cibles.filter((u) => u !== 'JSN' && Core.UNITS[u].att > 1);
        const illimite = [['JSN', 1e15], ...(frappeurs.length ? frappeurs : ['T']).map((u) => [u, 1e15])];
        const bloc = (o, avecStock) => {
          let hh = '';
          if (!o.passe) return `<div class="warn">Impossible de le passer en un tour avec ton armée : il manque ${fmt(o.manqueAtt * (1 + res.my.armes / 10))} de force de frappe (≈ ${fmt(o.manqueAtt / Core.UNITS.T.att)} Tk).</div>`;
          hh += `<table><tr><th>Unité</th>${avecStock ? '<th>Dispo</th>' : ''}<th>À envoyer</th><th>Pertes</th><th>Évoluent</th></tr>`;
          for (const x of o.rows) hh += `<tr><td>${L(x.c)}</td>${avecStock ? `<td class="mut">${fmt(x.dispo)}</td>` : ''}<td class="big">${fmt(x.envoi)}</td><td>${x.pertes ? fmt(x.pertes) : '—'}</td><td>${x.evol ? `${fmt(x.evol)} → ${L(x.vers)}` : '—'}</td></tr>`;
          const marge = (o.frappe / o.vieAdverse - 1) * 100;
          hh += `</table><table style="margin-top:4px">
            <tr><td>Force de frappe envoyée</td><td class="big ok">${fmt(o.frappe)}</td></tr>
            <tr><td>Vie adverse</td><td>${fmt(o.vieAdverse)} <span class="${marge >= 0 ? 'ok' : 'warn'}">(${marge >= 0 ? '✓ dépassée de +' : '✗ '}${f2(marge)} %)</span></td></tr>
            <tr><td>XP prévue</td><td class="${o.pct >= 99.9 ? 'ok' : 'warn'}">${f2(o.pct)} %</td></tr></table>`;
          if (o.jsnManque) hh += `<div class="warn">Il te manque ${fmt(o.jsnManque)} JSN pour encaisser la réplique : d’autres unités vont mourir.</div>`;
          if (o.pertesHorsJSN) hh += `<div class="warn">${fmt(o.pertesHorsJSN)} unités autres que des JSN meurent.</div>`;
          if (o.pct < 99.9) hh += '<div class="mut">XP partielle : ce mélange est déjà le plus léger qui passe en un tour avec ces unités.</div>';
          return hh;
        };
        const o0 = Core.optimize({ enemy: r.combat.defenders, eArmes: r.defArmes, eMult, my: res.my, avail: illimite, cibles });
        html += `<h4 style="margin-top:10px">🎯 Pour le passer en un tour (avec tes niveaux)</h4>
          <table>
          <tr><td>Vie à battre (×${f2(eMult)}${exactV ? '' : ', plafond'} × sécurité ${f2(cfg.secu)})</td><td class="big">${fmt(o0.vieABattre)}</td></tr>
          <tr><td>JSN tampon minimum (+${cfg.tampon ?? 5} %, bouclier ${res.my.bouclier}, ${res.my.source.bouclier})</td><td class="big">${fmt(o0.jsnNeed)} → ${fmt(o0.jsnMarge)}</td></tr>
          </table>
          <div class="mut" style="margin-top:6px">Armée conseillée (${cibles.map(L).join(' + ')}) :</div>` + bloc(o0, false);
        let choisi = o0;
        const mine = Core.parseArmyLoose(cfg.armee);
        if (mine.length) {
          const o = Core.optimize({ enemy: r.combat.defenders, eArmes: r.defArmes, eMult, my: res.my, avail: mine, cibles });
          html += `<h4 style="margin-top:8px">Envoi optimal depuis ton armée</h4>` + bloc(o, true);
          if (o.passe) choisi = o;
        }
        if (!exactV) html += '<div class="warn">Vie estimée par plafond : la vraie vie est plus basse, l’armée conseillée est prudente.</div>';
        // préparation pour le simulateur : armée conseillée contre ce défenseur, avec les niveaux déduits
        const pd = res.players.find((p) => p.name.toLowerCase() === String(dn).toLowerCase());
        const lieuSim = place || 'loge';
        let dB = pd && pd.bouclierLvl != null ? pd.bouclierLvl : null, niv = null;
        const rr = pd && pd.res[lieuSim];
        if (rr) { const c = rr.combos.length === 1 ? rr.combos[0] : rr.hyp; if (c) { niv = c.niveau; if (dB == null) dB = c.bouclier; } }
        if (dB == null) dB = Math.round(((lieuSim === 'terrain' ? eMult : eMult - (lieuSim === 'dome' ? 0.1 : 0.3)) - 1) * 10);
        ui.simPrep[i] = {
          att: Object.fromEntries(choisi.rows.map((x) => [x.c, x.envoi])),
          def: Object.fromEntries(r.combat.defenders),
          tech: { aB: res.my.bouclier, aA: res.my.armes, aC: cfg.cochenille || 0, dB, dA: r.defArmes, dC: 0 },
          lieu: { type: lieuSim, dome: lieuSim === 'dome' ? (niv ?? 0) : (cfg.sim && cfg.sim.lieu ? cfg.sim.lieu.dome : 0), loge: lieuSim === 'loge' ? (niv ?? 0) : (cfg.sim && cfg.sim.lieu ? cfg.sim.lieu.loge : 0) },
          nom: dn,
        };
        html += `<div class="row">${LITE ? '' : `<button class="b mini" type="button" data-tosim="${i}">⚔️ Tester dans le simulateur</button>`}${choisi.passe ? `<button class="b mini alt" type="button" data-copiearmee="${esc(texteArmee(choisi.rows.map((x) => [x.c, x.envoi])))}">📋 Copier l’armée conseillée</button>` : ''}</div>`;
      }
      html += '</div>';
    });
    out.innerHTML = html;
  }

  /* ============================ Onglet Simulateur ============================ */
  function vueSim() {
    const lignes = ORDER.map((c) => `<tr>
        <td><input class="n" data-sa="${c}" inputmode="numeric" value="0"></td>
        <td class="fl" data-cp="${c}" data-dir="toA" title="Copier la valeur du défenseur">‹</td>
        <td class="nom">${Core.NOMS[c][0]}</td>
        <td class="fl" data-cp="${c}" data-dir="toD" title="Copier la valeur de l’attaquant">›</td>
        <td><input class="n" data-sd="${c}" inputmode="numeric" value="0"></td></tr>`).join('');
    return `<div class="sim">
      <div data-simfiche></div>
      <div class="grille">
        <fieldset><legend>Armées <small>: <a data-av class="on">Avant Combat</a> / <a data-ap>Après Combat</a></small></legend>
          <table>
            <tr><th style="width:34%">Attaquant <span class="colle" data-coller="att" title="Coller une armée côté attaquant">📋</span></th><th></th><th class="fl" data-swap title="Échanger les deux armées">‹ ›</th><th></th><th style="width:34%"><span class="colle" data-coller="def" title="Coller une armée côté défenseur">📋</span> Défenseur</th></tr>
            ${lignes}
            <tr class="tot"><td data-tva>0</td><td></td><td class="c">❤ Vie</td><td></td><td data-tvd>0</td></tr>
            <tr class="tot"><td data-tda>0</td><td></td><td class="c">⚔ Dégât</td><td></td><td data-tdd>0</td></tr>
          </table>
          <div class="collebox" data-collebox hidden>
            <b data-colletitre></b>
            <textarea data-colleta placeholder="Colle ici l’armée : page Armée, rapport de combat ou liste « 456 Jeunes Soldates Naines, 1 450 Artilleuses »"></textarea>
            <div class="act"><button type="button" data-colleok>✓ Remplir</button><button type="button" data-collenon>Annuler</button></div>
            <div data-collemsg></div>
          </div>
        </fieldset>
        <div>
          <fieldset><legend>Technologies</legend>
            <table>
              <tr><th>Attaquant</th><th></th><th>Défenseur</th></tr>
              <tr><td><input class="lv" data-t="aB" value="0"></td><td class="nom">Bouclier Thoracique</td><td><input class="lv" data-t="dB" value="0"></td></tr>
              <tr><td><input class="lv" data-t="aA" value="0"></td><td class="nom">Armes</td><td><input class="lv" data-t="dA" value="0"></td></tr>
              <tr><td><input class="lv" data-t="aC" value="0"></td><td class="nom">Etable à cochenilles</td><td><input class="lv" data-t="dC" value="0"></td></tr>
            </table>
          </fieldset>
          <fieldset><legend>Lieu</legend>
            <label><input type="radio" name="simlieu" value="terrain"> Terrain de chasse</label>
            <label><input type="radio" name="simlieu" value="dome"> Fourmilière <span style="margin-left:auto">› <input class="lv" data-l="dome" value="0"></span></label>
            <label><input type="radio" name="simlieu" value="loge" checked> Loge Impériale <span style="margin-left:auto">› <input class="lv" data-l="loge" value="0"></span></label>
          </fieldset>
          <fieldset><legend>Votre Position</legend>
            <label style="display:inline-flex;margin-right:12px"><input type="radio" name="simpos" value="att" checked> Attaquant</label>
            <label style="display:inline-flex"><input type="radio" name="simpos" value="def"> Défenseur</label>
          </fieldset>
          <button type="button" class="fight" data-fight>Fight !</button>
          <fieldset class="rac"><legend>Raccourcis</legend>
            <button type="button" data-mine>Mon armée → attaquant</button>
            <button type="button" data-mytech>Mes niveaux → attaquant</button>
            <button type="button" data-vider>Tout vider</button>
          </fieldset>
        </div>
      </div>
      <h3 data-titre>Message que recevrait l'attaquant:</h3>
      <div class="msg" data-msg><span style="color:#5a4a2a">Remplis les armées puis clique sur « Fight ! ».</span></div>
      <div class="act" data-acts hidden><button type="button" data-cmsg>📋 Copier le message</button><button type="button" data-amsg>🔍 Analyser ce message</button></div>
    </div>`;
  }
  const nombreAff = (n) => Math.max(0, Math.floor(n || 0)).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
  function lireSim() {
    const v = panel.querySelector('[data-vue="sim"]');
    const att = {}, def = {}, tech = {};
    v.querySelectorAll('[data-sa]').forEach((i) => (att[i.dataset.sa] = Core.toInt(i.value)));
    v.querySelectorAll('[data-sd]').forEach((i) => (def[i.dataset.sd] = Core.toInt(i.value)));
    v.querySelectorAll('[data-t]').forEach((i) => (tech[i.dataset.t] = parseFloat(String(i.value).replace(',', '.')) || 0));
    const type = (v.querySelector('[name=simlieu]:checked') || {}).value || 'loge';
    const lieu = { type, dome: Core.toInt(v.querySelector('[data-l=dome]').value), loge: Core.toInt(v.querySelector('[data-l=loge]').value) };
    const pos = (v.querySelector('[name=simpos]:checked') || {}).value || 'att';
    return { att, def, tech, lieu, pos };
  }
  function remplirSim(s) {
    const v = panel.querySelector('[data-vue="sim"]');
    if (s.att) v.querySelectorAll('[data-sa]').forEach((i) => (i.value = nombreAff(s.att[i.dataset.sa] || 0)));
    if (s.def) v.querySelectorAll('[data-sd]').forEach((i) => (i.value = nombreAff(s.def[i.dataset.sd] || 0)));
    if (s.tech) v.querySelectorAll('[data-t]').forEach((i) => { if (s.tech[i.dataset.t] != null) i.value = s.tech[i.dataset.t]; });
    if (s.lieu) {
      const r = v.querySelector(`[name=simlieu][value="${s.lieu.type}"]`); if (r) r.checked = true;
      if (s.lieu.dome != null) v.querySelector('[data-l=dome]').value = s.lieu.dome;
      if (s.lieu.loge != null) v.querySelector('[data-l=loge]').value = s.lieu.loge;
    }
    if (s.pos) { const r = v.querySelector(`[name=simpos][value="${s.pos}"]`); if (r) r.checked = true; }
    ui.simNom = s.nom || ui.simNom;
    majTotaux(); garderSim(); majFiches();
  }
  /** Armée collée dans le simulateur ; dans un rapport de combat, on garde la ligne du bon camp. */
  function armeeCollee(texte, cote) {
    const m = String(texte || '').match(cote === 'def' ? /Troupes en d[ée]fense\s*:([^\n]*)/i : /Troupes en attaque\s*:([^\n]*)/i);
    return Core.parseArmyLoose(m ? m[1] : texte);
  }
  /** « 456 Jeunes Soldates Naines, 1 450 Artilleuses » : relisible par le simulateur. */
  const texteArmee = (rows) => rows.filter(([, n]) => n > 0).map(([c, n]) => `${nombreAff(n)} ${Core.NOMS[c][n > 1 ? 1 : 0]}`).join(', ');
  function garderSim() { const s = lireSim(); s.nom = ui.simNom; cfg.sim = s; saveCfg(cfg); }
  function majTotaux() {
    const v = panel.querySelector('[data-vue="sim"]');
    const s = lireSim();
    const A = ORDER.map((c) => [c, s.att[c] || 0]), D = ORDER.map((c) => [c, s.def[c] || 0]);
    const mA = 1 + s.tech.aB / 10, mD = Core.multLieu(s.tech.dB, s.lieu);
    v.querySelector('[data-tva]').textContent = fmtUp(Core.sumBy(A, 'vie') * mA);
    v.querySelector('[data-tda]').textContent = fmtUp(Core.sumBy(A, 'att') * (1 + s.tech.aA / 10));
    v.querySelector('[data-tvd]').textContent = fmtUp(Core.sumBy(D, 'vie') * mD);
    v.querySelector('[data-tdd]').textContent = fmtUp(Core.sumBy(D, 'def') * (1 + s.tech.dA / 10));
  }
  function initSim() {
    const v = panel.querySelector('[data-vue="sim"]');
    const msg = v.querySelector('[data-msg]'), acts = v.querySelector('[data-acts]');
    let avant = null, apres = null, dernier = '', cote = 'att';
    const boite = v.querySelector('[data-collebox]');
    v.addEventListener('input', (e) => { if (e.target.matches('input')) { majTotaux(); garderSim(); } });
    v.addEventListener('change', (e) => { if (e.target.matches('input[type=radio]')) { majTotaux(); garderSim(); } });
    v.addEventListener('focusout', (e) => { if (e.target.matches('input.n')) e.target.value = nombreAff(Core.toInt(e.target.value)); });
    v.addEventListener('focusin', (e) => { if (e.target.matches('input.n')) setTimeout(() => e.target.select(), 0); });
    v.addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.cp) {
        const a = v.querySelector(`[data-sa="${t.dataset.cp}"]`), d = v.querySelector(`[data-sd="${t.dataset.cp}"]`);
        if (t.dataset.dir === 'toA') a.value = d.value; else d.value = a.value;
        majTotaux(); garderSim();
      }
      if (t.matches('[data-swap]')) {
        ORDER.forEach((c) => { const a = v.querySelector(`[data-sa="${c}"]`), d = v.querySelector(`[data-sd="${c}"]`); [a.value, d.value] = [d.value, a.value]; });
        ['B', 'A', 'C'].forEach((k) => { const a = v.querySelector(`[data-t="a${k}"]`), d = v.querySelector(`[data-t="d${k}"]`); [a.value, d.value] = [d.value, a.value]; });
        majTotaux(); garderSim();
      }
      const co = t.closest('[data-coller]');
      if (co) {
        cote = co.dataset.coller;
        boite.hidden = false;
        boite.querySelector('[data-colletitre]').textContent = cote === 'att' ? 'Armée de l’attaquant' : 'Armée du défenseur';
        boite.querySelector('[data-collemsg]').textContent = '';
        const ta = boite.querySelector('[data-colleta]');
        ta.value = ''; ta.focus();
        // préremplit avec le presse-papiers quand le navigateur le permet ; sinon on colle à la main
        try { if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then((x) => { if (x && !ta.value) ta.value = x; }, () => {}); } catch (err) { /* lecture refusée */ }
      }
      if (t.matches('[data-collenon]')) boite.hidden = true;
      if (t.matches('[data-colleok]')) {
        const a = armeeCollee(boite.querySelector('[data-colleta]').value, cote);
        if (!a.length) { boite.querySelector('[data-collemsg]').textContent = 'Aucune unité reconnue dans ce texte.'; return; }
        remplirSim({ [cote]: Object.fromEntries(a) });
        boite.hidden = true;
      }
      if (t.matches('[data-av]') && avant) { remplirSim({ att: avant.att, def: avant.def }); t.classList.add('on'); v.querySelector('[data-ap]').classList.remove('on'); }
      if (t.matches('[data-ap]') && apres) { remplirSim({ att: apres.att, def: apres.def }); t.classList.add('on'); v.querySelector('[data-av]').classList.remove('on'); }
    });
    v.querySelector('[data-fight]').onclick = () => {
      const s = lireSim();
      const r = Core.simulate(s);
      avant = { att: s.att, def: s.def };
      apres = { att: r.apresAtt, def: r.apresDef };
      v.querySelector('[data-av]').classList.add('on'); v.querySelector('[data-ap]').classList.remove('on');
      dernier = Core.messageSimu(r, s.pos);
      v.querySelector('[data-titre]').textContent = `Message que recevrait ${s.pos === 'def' ? 'le défenseur' : "l'attaquant"}:`;
      // mise en gras des chiffres comme sur le site
      msg.innerHTML = esc(dernier)
        .replace(/(infligez?|inflige) ([\d ]+ \(\+ [\d ]+\))/g, '$1 <b>$2</b>')
        .replace(/(tuez|en tue) ([\d ]+)/g, '$1 <b>$2</b>')
        .replace(/(Vous avez (?:gagné|perdu) cette bataille !|Match nul\.)/g, '<b>$1</b>')
        .replace(/sont devenues des (.+)/g, 'sont devenues des <b>$1</b>');
      if (r.xp) msg.innerHTML += `\n\n<span style="color:#5a4a2a">XP : ${f2(r.xp.pct)} % (plafonné à 100 %) · vie défenseur ×${f2(r.mD)}</span>`;
      acts.hidden = false;
    };
    v.querySelector('[data-cmsg]').onclick = (e) => copier(dernier, e.target);
    v.querySelector('[data-amsg]').onclick = () => {
      const s = lireSim();
      const lieuTxt = { terrain: 'le terrain de chasse', dome: 'la fourmilière', loge: 'la Loge Impériale' }[s.lieu.type];
      const entete = s.pos === 'def' ? `Simulation attaque votre ${lieuTxt.replace(/^(le|la) /, '')}` : `Vous attaquez ${lieuTxt} de ${ui.simNom || 'Simulation'}`;
      ui.rcTa.value = `${entete}\n${dernier}`;
      cfg.rapport = ui.rcTa.value; saveCfg(cfg);
      render(ui.rcTa.value, ui.rcOut); onglet('rc');
    };
    v.querySelector('[data-mine]').onclick = () => {
      const a = Core.parseArmyLoose(cfg.armee);
      if (!a.length) { msg.textContent = 'Ton armée est vide : colle-la dans « Mon armée » (onglet Analyse RC).'; return; }
      remplirSim({ att: Object.fromEntries(a) });
    };
    v.querySelector('[data-mytech]').onclick = () => remplirSim({ tech: { aB: cfg.bouclier || 0, aA: cfg.armes || 0, aC: cfg.cochenille || 0 } });
    v.querySelector('[data-vider]').onclick = () => { ui.simNom = ''; remplirSim({ att: {}, def: {} }); msg.textContent = ''; acts.hidden = true; avant = apres = null; };
    if (cfg.sim) remplirSim(cfg.sim); else remplirSim({ tech: { aB: cfg.bouclier || 0, aA: cfg.armes || 0, aC: cfg.cochenille || 0 } });
  }

  /* ============================ Cibles à portée au départ (données OlympusBot) ============================
   * Seule partie de SimuOpti qui fait des requêtes : vers olympusbot.duckdns.org uniquement (jamais fourmizzz.fr),
   * via GM_xmlhttpRequest, que la page du jeu ne voit pas.
   *  - carte du site : position, alliance et TDC actuel de chaque joueur ;
   *  - traceur (7 jours) de l'attaquant : son TDC au moment du départ ;
   *  - portée : un joueur attaque une cible dont le TDC est entre la moitié et le triple du sien ;
   *  - trajet = 637 200 × (1 − e^(−distance/350)) × 0,9^VA (formule de FourmiWatch). */
  const OLY = 'https://olympusbot.duckdns.org';
  const PORTEE_MIN = 0.5, PORTEE_MAX = 3;
  const NOTRE_ALLY = 'C6P';
  function gmGet(url) {
    return new Promise((ok, ko) => {
      if (LITE) { ko(new Error('Fonction indisponible dans la version web.')); return; }
      // Application Android : pont natif Android.olyGet (OlympusBot uniquement), authentifié par le code personnel
      if (window.Android && typeof window.Android.olyGet === 'function') {
        const code = String(cfg.olyCode || '').trim();
        if (!code) { ko(new Error('Entre ton code dans le champ ci-dessus pour déverrouiller cette fonction.')); return; }
        const attente = (window.__olyAttente = window.__olyAttente || {});
        const id = 'r' + Date.now() + Math.random().toString(36).slice(2);
        attente[id] = { ok, ko, t: setTimeout(() => { delete attente[id]; ko(new Error('Le serveur ne répond pas.')); }, 25000) };
        window.__olyRetour = window.__olyRetour || ((i, statut, corps) => {
          const w = window.__olyAttente[i]; if (!w) return;
          clearTimeout(w.t); delete window.__olyAttente[i];
          if (statut < 0) w.ko(new Error('Serveur injoignable (pas de réseau ?).')); else w.ok({ status: statut, responseText: corps });
        });
        window.Android.olyGet(id, url, code);
        return;
      }
      if (typeof GM_xmlhttpRequest !== 'function') { ko(new Error(APP ? 'Mets à jour l’application : cette version ne gère pas encore cette fonction.' : 'Requêtes indisponibles : réinstalle le script (autorisation GM_xmlhttpRequest).')); return; }
      GM_xmlhttpRequest({ method: 'GET', url, timeout: 20000, onload: ok, onerror: () => ko(new Error('Serveur injoignable.')), ontimeout: () => ko(new Error('Le serveur ne répond pas.')) });
    });
  }
  const accesRefuse = () => new Error(APP ? 'Accès refusé : vérifie ton code.' : 'Accès refusé : déverrouille d’abord le site avec ton code dans ce navigateur, puis réessaie.');
  let carteOly = { t: 0, parNom: null };
  async function lireCarteOly() {
    if (carteOly.parNom && Date.now() - carteOly.t < 10 * 60 * 1000) return carteOly.parNom;
    const r = await gmGet(`${OLY}/carte/donnees.json`);
    let j = null;
    try { j = JSON.parse(r.responseText); } catch (e) { throw accesRefuse(); }
    if (r.status !== 200 || !j || !Array.isArray(j.players)) throw accesRefuse();
    const parNom = {};
    // [id, pseudo, alliance, x, y, TDC, ?, inactif]
    for (const p of j.players) parNom[String(p[1]).toLowerCase()] = { pseudo: p[1], ally: p[2] || '', x: p[3], y: p[4], tdc: p[5], inactif: p[7] === 1 };
    carteOly = { t: Date.now(), parNom };
    return parNom;
  }
  const n0 = (t) => parseInt(String(t || '').replace(/[^\d-]/g, ''), 10) || 0;
  function dateTraceur(txt) {
    const m = String(txt).match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const now = new Date();
    let d = new Date(now.getFullYear(), +m[2] - 1, +m[1], +m[3], +m[4], +(m[5] || 0));
    if (d.getTime() > Date.now() + 86400000) d = new Date(now.getFullYear() - 1, +m[2] - 1, +m[1], +m[3], +m[4], +(m[5] || 0));
    return d.getTime();
  }
  /** Mouvements de TDC d'un joueur : [{ ts, avant, apres }] du plus ancien au plus récent (page joueur, sinon traceur). */
  async function mouvementsOly(pseudo) {
    try { return (await joueurOly(pseudo)).map((e) => ({ ts: e.ts, avant: e.avant, apres: e.apres })); }
    catch (e) { /* page joueur illisible : traceur en secours */ }
    const r = await gmGet(`${OLY}/traceur?q=${encodeURIComponent(pseudo)}&h=168`);
    if (r.status !== 200 || !/kind-|Aucun mouvement/.test(r.responseText)) throw accesRefuse();
    const doc = new DOMParser().parseFromString(r.responseText, 'text/html');
    const out = [];
    for (const tr of doc.querySelectorAll('tbody tr[class*="kind-"]')) {
      const qui = [...tr.querySelectorAll('.who a')].find((a) => a.textContent.trim().toLowerCase() === pseudo.toLowerCase());
      const sub = tr.querySelector('.sub.nw');
      const ts = dateTraceur((tr.querySelector('.when') || {}).textContent);
      const m = sub && sub.textContent.replace(/[  ]/g, ' ').match(/([\d ]+)→\s*([\d ]+)/);
      if (qui && ts && m) out.push({ ts, avant: n0(m[1]), apres: n0(m[2]) });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }
  const memeNom = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  /**
   * Historique « Terrain de chasse » de la page joueur d'OlympusBot (la source que lit FourmiWatch), du plus ancien
   * au plus récent : [{ ts, debut, kind, delta, avant, apres, autre, autreAlly }].
   * kind : 'hunt' (chasse), 'chain' (flood d'alliance), 'unknown' (inconnu), 'attack' (autre prise ou perte).
   */
  const pageCache = {};
  async function joueurOly(pseudo) {
    const k = String(pseudo).toLowerCase();
    if (pageCache[k] && Date.now() - pageCache[k].t < 5 * 60000) return pageCache[k].v;
    const r = await gmGet(`${OLY}/joueur/${encodeURIComponent(pseudo)}`);
    if (r.status === 404) throw new Error(`${pseudo} : page joueur introuvable.`);
    if (r.status !== 200) throw accesRefuse();
    const doc = new DOMParser().parseFromString(r.responseText, 'text/html');
    const lis = doc.querySelectorAll('li.ev');
    if (!lis.length && !/Historique|Terrain de chasse|cm²/i.test(doc.body ? doc.body.textContent : '')) throw accesRefuse();
    const out = [];
    for (const li of lis) {
      if (!/Terrain de chasse/i.test((li.querySelector('.ev-name') || {}).textContent || '')) continue;
      const sub = ((li.querySelector('.ev-sub') || {}).textContent || '').replace(/[\s   ]+/g, ' ');
      const m = sub.match(/(\d{1,2}\/\d{1,2} \d{1,2}:\d{2}(?::\d{2})?).*?([\d ]+)\s*→\s*([\d ]+)\s*cm/);
      const ts = m ? dateTraceur(m[1]) : null;
      if (!ts) continue;
      const mv = li.querySelector('.ev-move');
      const lien = mv ? [...mv.querySelectorAll('a')].find((a) => !a.classList.contains('tag')) : null;
      const tag = mv ? mv.querySelector('a.tag') : null;
      const badge = mv ? ((mv.querySelector('.mvbadge') || {}).textContent || '') : '';
      const avant = n0(m[2]), apres = n0(m[3]);
      // type donné par la page (data-kind : hunt, chain, steal, unknown, autre), sinon déduit du badge
      const dk = li.getAttribute('data-kind') || '';
      out.push({ ts, debut: null, kind: dk === 'hunt' || dk === 'chain' || dk === 'unknown' ? dk : dk ? 'attack' : /chasse/i.test(badge) ? 'hunt' : /flood/i.test(badge) ? 'chain' : /inconnu/i.test(badge) ? 'unknown' : 'attack',
        delta: apres - avant, avant, apres, autre: lien ? lien.textContent.trim() : '', autreAlly: tag ? tag.textContent.trim() : '' });
    }
    const v = out.sort((a, b) => a.ts - b.ts);
    pageCache[k] = { t: Date.now(), v };
    return v;
  }
  /** Page joueur, complétée des fenêtres de scan lues dans le traceur (quand il les donne). */
  async function mouvementsJoueur(pseudo) {
    const mv = (await joueurOly(pseudo)).map((e) => ({ ...e }));
    let scans = {};
    try { scans = (await traceurOly(pseudo)).scans || {}; } catch (e) { /* traceur illisible : fenêtre par défaut */ }
    for (const e of mv) { const d = scans[Math.floor(e.ts / 60000) * 60000]; if (d != null) e.debut = d; }
    return mv;
  }
  /**
   * Traceur (7 jours) d'un joueur, avec les deux camps de chaque mouvement et la fenêtre de scan :
   * « Scan de 12/10 17:47 · comparé au scan de 12/10 17:46 » → les mouvements qui suivent ont eu lieu entre les deux.
   * [{ ts, debut, kind, delta, avant, apres, autre, autreAlly, autreAvant, autreApres }] du plus ancien au plus récent.
   */
  const traceurCache = {};
  async function traceurOly(pseudo) {
    const k = String(pseudo).toLowerCase();
    if (traceurCache[k] && Date.now() - traceurCache[k].t < 5 * 60000) return traceurCache[k].v;
    const camp = (td) => {
      if (!td) return {};
      const who = td.querySelector('.who');
      const lien = who ? [...who.querySelectorAll('a')].find((a) => !a.classList.contains('tag')) : null;
      const tag = who ? who.querySelector('a.tag') : null;
      const amt = td.querySelector('.amt'), sub = td.querySelector('.sub');
      const av = sub ? (sub.textContent.replace(/[\s   ]+/g, ' ').match(/([\d ]+)→\s*([\d ]+)/) || []) : [];
      return { nom: lien ? lien.textContent.trim() : '', ally: tag ? tag.textContent.trim() : '',
        delta: amt ? n0(amt.textContent) : null, avant: av[1] ? n0(av[1]) : null, apres: av[2] ? n0(av[2]) : null };
    };
    const out = [], vus = new Set();
    let debutScan = null, pages = 0, coupe = false;
    const scans = {}; // heure de scan → scan précédent
    for (let page = 1; page <= 6; page++) {
      pages = page;
      const r = await gmGet(`${OLY}/traceur?q=${encodeURIComponent(pseudo)}&h=168${page > 1 ? '&page=' + page : ''}`);
      if (r.status !== 200 || !/kind-|Aucun mouvement/.test(r.responseText)) throw accesRefuse();
      const doc = new DOMParser().parseFromString(r.responseText, 'text/html');
      for (const tr of doc.querySelectorAll('tbody tr')) {
        if (/scanrow/.test(tr.className || '')) {
          const m = (tr.textContent || '').replace(/[\s   ]+/g, ' ').match(/Scan de (\d{1,2}\/\d{1,2} \d{1,2}:\d{2}).*?scan de (\d{1,2}\/\d{1,2} \d{1,2}:\d{2})/i);
          debutScan = m ? dateTraceur(m[2]) : null;
          if (m && debutScan) scans[dateTraceur(m[1])] = debutScan;
          continue;
        }
        const kind = ((tr.className || '').match(/kind-(\w+)/) || [])[1];
        if (!kind) continue;
        const ts = dateTraceur((tr.querySelector('.when') || {}).textContent);
        const tds = tr.querySelectorAll('td');
        const j = camp(tds[1]), o = camp(tds[3]);
        const [moi, autre] = memeNom(j.nom, pseudo) ? [j, o] : memeNom(o.nom, pseudo) ? [o, j] : [null, null];
        if (!ts || !moi) continue;
        const delta = moi.avant != null && moi.apres != null ? moi.apres - moi.avant : moi === j ? j.delta : j.delta != null ? -j.delta : null;
        const cle = `${ts}|${delta}|${autre.nom}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        out.push({ ts, debut: debutScan, kind, delta, avant: moi.avant, apres: moi.apres,
          autre: autre.nom || '', autreAlly: autre.ally || '', autreAvant: autre.avant, autreApres: autre.apres });
      }
      if (![...doc.querySelectorAll('a')].some((a) => /Suivant/i.test(a.textContent))) break;
      if (page === 6) { coupe = true; break; }
      await pause(400);
    }
    const v = out.sort((a, b) => a.ts - b.ts);
    v.pages = pages; v.coupe = coupe; v.scans = scans;
    traceurCache[k] = { t: Date.now(), v };
    return v;
  }
  /** Historique de TDC (pour la règle de portée) à partir du traceur. */
  // avant son plus ancien mouvement affiché, son TDC est inconnu (la page ne montre que les derniers)
  const histTdc = (mv, actuel) => ({ depuis: mv.length ? mv[0].ts : Date.now() - 168 * 3600000, actuel,
    ev: mv.filter((e) => e.avant != null && e.apres != null).map((e) => ({ ts: e.ts, avant: e.avant, apres: e.apres })) });
  /** Attaques menées par le joueur : terrain pris à un autre joueur (hors chasse), victime placée sur la carte. */
  function attaquesDe(a, mv, pos) {
    return mv.filter((e) => e.delta > 0 && e.autre && e.kind !== 'hunt').map((e) => {
      const p = pos[e.autre.toLowerCase()];
      return p ? { ts: e.ts, debut: e.debut, victime: p.pseudo, cm: e.delta, d: Math.hypot(p.x - a.x, p.y - a.y),
        flood: e.kind === 'chain' || (!!a.ally && memeNom(p.ally, a.ally)) } : null;
    }).filter((x) => x && x.d > 0);
  }
  /**
   * VA exacte connue d'OlympusBot : pour les joueurs qui utilisent le script de l'alliance, la page Ennemis est
   * « préremplie d'après ton script » avec leur vraie vitesse d'attaque.
   */
  const vaSiteCache = {};
  async function vaOlympus(pseudo) {
    const k = String(pseudo).toLowerCase();
    if (vaSiteCache[k] && Date.now() - vaSiteCache[k].t < 3600000) return vaSiteCache[k].va;
    const r = await gmGet(`${OLY}/ennemis?pseudo=${encodeURIComponent(pseudo)}`);
    if (r.status !== 200) { vaSiteCache[k] = { t: Date.now(), va: null, etat: r.status >= 300 && r.status < 400 ? `redirigée (${r.status})` : `page Ennemis illisible (erreur ${r.status})` }; return null; }
    const doc = new DOMParser().parseFromString(r.responseText, 'text/html');
    const txt = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ');
    const m = txt.match(/Prérempli d'après (?:ton|son|le) script[^.]*?Vitesse d'attaque\D{0,20}(\d{1,2})/i);
    const va = m ? +m[1] : null;
    const etat = m ? 'VA préremplie' : /installation/i.test(r.responseText) && !/Vitesse d'attaque/i.test(txt) ? 'page non accessible avec ce code' : /Prérempli/i.test(txt) ? 'page préremplie, mais sans vitesse d’attaque lisible'
      : /Vitesse d'attaque/i.test(txt) ? 'vitesse d’attaque non partagée' : 'aucune vitesse d’attaque sur la page';
    vaSiteCache[k] = { t: Date.now(), va, etat };
    return va;
  }
  /**
   * VA d'un joueur d'après ses mouvements sur OlympusBot, dans cet ordre :
   *  1. VA exacte connue d'OlympusBot ;
   *  2. une seule armée (case cochée) : son enchaînement le plus serré ;
   *  3. départs synchronisés (sessions de lancement vers des cibles à des distances différentes) : marche avec
   *     plusieurs armées en route, repère aussi un changement de VA ;
   *  4. sinon, enchaînements de ses attaques classiques (pas les floods d'alliance, presque toujours faits avec
   *     plusieurs armées), relevés aux minimums sûrs : nombre d'armées en route (au plus VA + 1) et règle de portée.
   * Les attaques qu'OlympusBot a classées en chasse sont rattrapées : même montant perdu, au même relevé, par une
   * de ses victimes habituelles (perte « Inconnu »).
   */
  async function analyserVaOly(pseudo, { uneArmee = false, progres = () => {} } = {}) {
    progres('Lecture de la carte…');
    const pos = await lireCarteOly();
    const a = pos[String(pseudo).trim().toLowerCase()];
    if (!a) throw new Error(`${pseudo} n’est pas sur la carte.`);
    let vaSite = null;
    try { vaSite = await vaOlympus(a.pseudo); } catch (e) { /* page Ennemis illisible : on estime */ }
    progres(`Lecture de l’historique de ${a.pseudo}…`);
    const mv = await mouvementsJoueur(a.pseudo);
    const attaques = attaquesDe(a, mv, pos);
    const res = { a, vaSite, attaques, uneArmee, plancher: null, nPlancher: 0, rattrapees: 0 };
    const gains = mv.filter((e) => e.delta > 0 && e.autre && e.kind !== 'hunt');
    res.diag = { lignes: mv.length, chasses: mv.filter((e) => e.delta > 0 && (e.kind === 'hunt' || !e.autre)).length,
      pertes: mv.filter((e) => e.delta < 0).length, prises: gains.length, horsCarte: gains.filter((e) => !pos[e.autre.toLowerCase()]).length,
      ennemis: (vaSiteCache[a.pseudo.toLowerCase()] || {}).etat || 'page Ennemis non lue' };
    const histAtt = histTdc(mv, a.tdc), hist = {}, pagesV = {};
    if (vaSite == null && attaques.length) {
      // pages de ses victimes (les plus fréquentes et les plus récentes, 10 au plus) : fausses chasses, portée, remontées
      const freq = {};
      attaques.forEach((x) => { freq[x.victime] = (freq[x.victime] || 0) + 1; });
      const victimes = [...new Set([...Object.keys(freq).sort((p, q) => freq[q] - freq[p]).slice(0, 6), ...attaques.slice(-20).map((x) => x.victime)])].slice(0, 10);
      for (const [i, v] of victimes.entries()) {
        progres(`Historique de ${v} (${i + 1}/${victimes.length})…`);
        try { const p = await joueurOly(v); pagesV[v.toLowerCase()] = p; hist[v.toLowerCase()] = histTdc(p, (pos[v.toLowerCase()] || {}).tdc); } catch (e) { /* victime illisible : ignorée */ }
        await pause(400);
      }
      // fausses chasses : gain « chasse » au même relevé (± 2 min) qu'une perte sans auteur de 50 à 102 % de ce gain
      for (const e of mv.filter((x) => x.delta > 0 && (x.kind === 'hunt' || !x.autre))) {
        for (const v of victimes) {
          const pv = pagesV[v.toLowerCase()], p = pos[v.toLowerCase()];
          if (!pv || !p) continue;
          if (pv.some((x) => x.delta < 0 && !x.autre && Math.abs(x.ts - e.ts) <= 2 * 60000 && -x.delta >= e.delta * 0.5 && -x.delta <= e.delta * 1.02)) {
            attaques.push({ ts: e.ts, debut: e.debut, victime: p.pseudo, cm: e.delta, d: Math.hypot(p.x - a.x, p.y - a.y), flood: !!a.ally && memeNom(p.ally, a.ally), rattrapee: true });
            res.rattrapees++;
            break;
          }
        }
      }
      attaques.sort((x, y) => x.ts - y.ts);
    }
    res.scansConnus = attaques.filter((x) => x.debut != null).length;
    // minimums sûrs : armées en route (au plus VA + 1) et portée au départ
    const mA = Core.minArmees(attaques);
    res.minArmees = mA.va; res.armeesEnRoute = mA.armees;
    if (vaSite == null && attaques.length) {
      const p = Core.plancherPortee(attaques.filter((x) => hist[x.victime.toLowerCase()]), (n) => (n == null ? histAtt : hist[n.toLowerCase()]));
      res.plancher = p.va; res.nPlancher = p.n;
    }
    res.minimum = Math.max(res.minArmees ?? 0, res.plancher ?? 0) || null;
    // départs synchronisés (toutes les attaques, floods compris)
    const sy = Core.vaSynchro(attaques);
    res.synchro = sy;
    // enchaînements : attaques classiques seulement ; la case « une armée » les prend toutes
    const classiques = uneArmee ? attaques : attaques.filter((x) => !x.flood);
    const est = Core.vaEnchainements(classiques);
    res.est = est;
    res.floods = attaques.filter((x) => x.flood).length;
    if (!uneArmee && est.va != null) {
      const brute = est.va, d = Core.departagerRemontees(est, (n) => hist[String(n).toLowerCase()] || null);
      est.va = d.va; res.remontees = d.expliques; res.alternative = d.alternative; res.vaBrute = brute;
    }
    const r = est.relance;
    if (vaSite != null) { res.va = vaSite; res.confiance = 'exacte'; }
    else if (uneArmee && r && (res.plancher == null || r.vaMin >= res.plancher)) {
      res.va = r.vaMin;
      // relance en quelques minutes : VA exacte ; sinon il n'a jamais relancé vite, c'est un minimum
      res.confiance = r.delai <= 8 * 60 ? 'unearmee' : 'unearmee-min';
    }
    else if (sy.confiance !== 'insuffisante') {
      res.va = sy.va; res.confiance = 'synchro';
      if (res.minimum != null && sy.va < res.minimum) res.conflit = true; // à signaler : la synchro contredit un minimum
    }
    else if (est.va != null && est.va >= (res.minimum ?? 0)) { res.va = est.va; res.confiance = est.confiance; }
    else if (res.minimum != null) { res.va = res.minimum; res.confiance = 'plancher'; }
    else { res.va = null; res.confiance = 'aucune'; }
    est.indices.forEach((x) => { x.retenu = res.va != null && x.vaMin === res.va; x.parallele = res.va != null && (x.vaMin > res.va + 1 || (!!x.remontee && x.vaMin > res.va)); });
    res.doubles = est.indices.filter((x) => x.parallele).length;
    return res;
  }
  /**
   * Mesure à partir du départ calculé d'après un RC : sa 1re prise de terrain relevée après le départ.
   * Arrivée connue à la fenêtre de scan près : donne la VA exacte, ou une fourchette si les scans sont espacés.
   */
  async function vaDepuisDepart(pseudo, depart, precision) {
    const pos = await lireCarteOly();
    const a = pos[String(pseudo).trim().toLowerCase()];
    if (!a) throw new Error(`${pseudo} n’est pas sur la carte.`);
    const att = attaquesDe(a, await mouvementsJoueur(a.pseudo), pos).filter((x) => x.ts - Core.PRISE_MIN * 1000 > depart);
    const suite = att.slice(0, 3).map((x) => ({ ...x, r: Core.vaDepuisArrivee({ depart, debut: x.debut, ts: x.ts, d: x.d, precision: precision || 0 }) }));
    return { a, suite };
  }

  /** Liste des cibles à portée au départ, avec l'heure d'arrivée si la VA est connue. */
  async function ciblesAuDepart({ pseudo, depart, va, moi: monPseudo, maVa }) {
    const pos = await lireCarteOly();
    const a = pos[String(pseudo).toLowerCase()];
    if (!a) throw new Error(`${pseudo} n’est pas sur la carte.`);
    let tdcDepart = a.tdc, source = 'TDC actuel (aucun mouvement depuis son départ)';
    try {
      const mv = await mouvementsOly(a.pseudo);
      const apres = mv.find((e) => e.ts > depart);
      if (apres) { tdcDepart = apres.avant; source = `TDC juste avant le relevé du ${new Date(apres.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`; }
    } catch (e) { source = 'TDC actuel (traceur illisible)'; }
    const bas = tdcDepart * PORTEE_MIN, haut = tdcDepart * PORTEE_MAX;
    // moi : distance jusqu'à lui, mon trajet, et est-il dans ma portée ?
    const mp = monPseudo ? pos[String(monPseudo).toLowerCase()] : null;
    const moi = mp && mp !== a ? (() => {
      const d = Math.hypot(mp.x - a.x, mp.y - a.y);
      return { pseudo: mp.pseudo, d, va: maVa, t: Core.trajet(d, maVa == null ? 0 : maVa), aPortee: a.tdc >= mp.tdc * PORTEE_MIN && a.tdc <= mp.tdc * PORTEE_MAX, tdc: mp.tdc };
    })() : null;
    const groupes = [];
    const allies = [NOTRE_ALLY];
    if (a.ally && a.ally.toUpperCase() !== NOTRE_ALLY) allies.push(a.ally);
    for (const ally of allies) {
      const membres = Object.values(pos).filter((p) => p !== a && p.ally && p.ally.toUpperCase() === ally.toUpperCase());
      const lignes = membres.map((p) => {
        const d = Math.hypot(p.x - a.x, p.y - a.y);
        const t = Core.trajet(d, va == null ? 0 : va);
        const aPortee = p.tdc >= bas && p.tdc <= haut;
        const arrivee = depart + t * 1000;
        return { pseudo: p.pseudo, ally: p.ally, tdc: p.tdc, d, t, arrivee, aPortee, inactif: p.inactif };
      });
      groupes.push({
        ally, notre: ally.toUpperCase() === NOTRE_ALLY,
        aPortee: lignes.filter((l) => l.aPortee).sort((x, y) => x.arrivee - y.arrivee),
        hors: lignes.filter((l) => !l.aPortee).length,
      });
    }
    return { a, tdcDepart, source, bas, haut, va, depart, groupes, moi, monPseudo };
  }
  function eta(ms, passe = 'passé') {
    const s = (ms - Date.now()) / 1000;
    if (s <= 0) return { txt: passe, cls: 'past' };
    return { txt: 'dans ' + Core.dureeTexte(s), cls: s < 900 ? 'urgent' : s < 3600 ? 'proche' : 'loin' };
  }
  const hms = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const heureCourte = (ms) => new Date(ms).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const debutMinute = (ms) => Math.floor(ms / 60000) * 60000;
  /**
   * Règles des retours (données par un joueur, vérifiées en jeu) :
   *  - à l'arrivée, l'armée attend en stand-by jusqu'à la fin de la minute ;
   *  - attaque de TDC ou de dôme : à la fin de cette minute, retour instantané chez lui ;
   *  - attaque de loge : à la fin de cette minute, trajet retour (même durée que l'aller), puis stand-by chez lui
   *    jusqu'à la fin de la minute où il arrive.
   *  Pour le prendre avec son armée, on vise son nid à la seconde 59 de cette minute (ou la seconde 00 qui suit).
   */
  function timing(l, mode, tMoi) {
    const finAller = debutMinute(l.arrivee) + 60000;                 // fin de la minute d'arrivée (seconde 00 suivante)
    const retour = mode === 'loge' ? finAller + l.t * 1000 : finAller; // armée de retour chez lui
    const impact59 = debutMinute(mode === 'loge' ? retour : l.arrivee) + 59000;
    const lance = tMoi != null ? Math.round((impact59 - tMoi * 1000) / 1000) * 1000 : null;
    return { finAller, retour, impact59, lance };
  }
  function rendreCibles(r, opts = {}) {
    const mode = opts.mode === 'loge' ? 'loge' : 'dome';
    const vaConnue = r.va != null;
    const m = r.moi;
    const tMoi = opts.monTrajet != null ? opts.monTrajet : m && m.va != null ? m.t : null;
    const viser = vaConnue && m && tMoi != null;
    const sur = vaConnue ? '' : '≤ ';
    let h = `<div class="cb-tete">
        <div><b>${esc(r.a.pseudo)}</b>${r.a.ally ? ` <span class="cb-ally">${esc(r.a.ally)}</span>` : ' <span class="mut">sans alliance</span>'} · parti ${heureCourte(r.depart)} · TDC au départ ${fmt(r.tdcDepart)}</div>
        <div class="mut">Ses cibles possibles : TDC de ${fmt(r.bas)} à ${fmt(r.haut)} cm² (${esc(r.source)}).</div>
        ${vaConnue ? `<div class="mut">Sa VA ${r.va}.</div>` : '<div class="warn">Sa VA est inconnue : trajets calculés à VA 0, donc <b>au plus tard</b>. Renseigne sa VA pour viser la bonne seconde.</div>'}
        ${m ? `<div>${m.aPortee ? '✅' : '⛔'} Toi (${esc(m.pseudo)}) : à ${f2(m.d)} cases de lui · ton trajet ${tMoi != null ? `<b>${Core.dureeTexte(tMoi)}</b>${opts.monTrajet != null ? ' (affiché par le jeu)' : ` (VA ${m.va}, calculé)`}` : '? — renseigne ta VA ou ton trajet'}${m.aPortee ? '' : ' · <b>il est hors de ta portée</b> (TDC actuel)'}.</div>` : `<div class="mut">Renseigne ton pseudo (onglet Analyse RC) pour savoir à quelle heure lancer.</div>`}
      </div>
      <div class="cb-mode">${[['dome', 'S’il attaque en TDC / dôme'], ['loge', 'S’il attaque en loge']].map(([k, t]) => `<button type="button" class="${mode === k ? 'on' : ''}" data-cbmode="${k}">${t}</button>`).join('')}</div>
      <div class="mut" style="margin:2px 0 6px">${mode === 'loge'
        ? 'Loge : à la fin de la minute de son arrivée, son armée repart (même trajet) et attend chez lui jusqu’à la fin de la minute de son retour.'
        : 'TDC / dôme : son armée attend sur place jusqu’à la fin de la minute, puis rentre instantanément chez lui.'} On vise son nid à la <b>seconde 59</b> de cette minute (ou la seconde 00 qui suit).</div>`;
    for (const g of r.groupes) {
      h += `<div class="cb-grp ${g.notre ? 'nous' : ''}"><div class="cb-grp-h">${g.notre ? '🛡️' : '🐜'} ${esc(g.ally)} ${g.notre ? '— nos membres qu’il peut toucher' : '— sa propre alliance (flood interne)'} <span class="cb-n">${g.aPortee.length}</span></div>`;
      if (!g.aPortee.length) h += `<div class="mut" style="padding:6px 8px">Aucun membre à sa portée${g.hors ? ` (${g.hors} hors portée)` : ''}.</div>`;
      else {
        h += `<table class="cb-tab"><tr><th>S’il frappe…</th><th>Il arrive</th>${mode === 'loge' ? '<th>Retour dans sa loge</th>' : ''}<th>Impact chez lui</th>${viser ? '<th>Tu lances à</th>' : ''}<th></th></tr>`;
        for (const l of g.aPortee) {
          const tm = timing(l, mode, viser ? tMoi : null);
          const cible = viser ? tm.lance : tm.impact59;
          const e = eta(cible, viser ? 'trop tard' : 'passé');
          h += `<tr class="${e.cls}"><td><b>${esc(l.pseudo)}</b>${l.inactif ? ' <span class="cb-tag ina">inactif</span>' : ''}<div class="mut">${fmt(l.tdc)} cm² · trajet ${sur}${Core.dureeTexte(l.t)}</div></td>
            <td>${sur}${hms(l.arrivee)}<div class="mut">${new Date(l.arrivee).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div></td>
            ${mode === 'loge' ? `<td>${sur}${hms(tm.retour)}<div class="mut">repart à ${hms(tm.finAller)}</div></td>` : ''}
            <td><b>${sur}${hms(tm.impact59)}</b><div class="mut">ou ${hms(tm.impact59 + 1000)}</div></td>
            ${viser ? `<td><b class="cb-lance">${hms(tm.lance)}</b><div class="mut">ou ${hms(tm.lance + 1000)}</div></td>` : ''}
            <td><span class="cb-eta ${e.cls}" data-eta="${cible}" data-passe="${viser ? 'trop tard' : 'passé'}">${e.txt}</span></td></tr>`;
        }
        h += '</table>';
        if (g.hors) h += `<div class="mut" style="padding:2px 8px 6px">${g.hors} autre${g.hors > 1 ? 's' : ''} membre${g.hors > 1 ? 's' : ''} hors de sa portée au départ.</div>`;
      }
      h += '</div>';
    }
    h += `<div class="mut">Précision : ${opts.precision ? `départ connu à <b>± ${Math.ceil(opts.precision)} s</b> (temps de ponte d’une unité)` : 'départ saisi à la main'} ; la formule de trajet peut s’écarter de quelques secondes du jeu. ${viser && opts.monTrajet == null ? 'Saisis le trajet affiché par le jeu pour lancer à la seconde.' : ''}</div>`;
    return h;
  }
  // comptes à rebours, tant que la liste est affichée
  setInterval(() => {
    if (!racine) return;
    racine.querySelectorAll('[data-eta]').forEach((el) => {
      const e = eta(+el.dataset.eta, el.dataset.passe || 'passé');
      el.textContent = e.txt; el.className = 'cb-eta ' + e.cls;
      const tr = el.closest('tr'); if (tr) tr.className = e.cls;
    });
  }, 15000);

  /* ============================ Onglet VA & TdP ============================ */
  function vueVa() {
    return `
      <div class="seg" data-seg>
        ${LITE ? '' : '<button type="button" data-vs="oly">🔎 <span class="long">VA d’après ses attaques</span><span class="court">VA auto</span></button>'}
        <button type="button" data-vs="mesure">📏 <span class="long">Mesure &amp; trajet</span><span class="court">Mesure</span></button>
        <button type="button" data-vs="tdp">🥚 <span class="long">TdP &amp; départ</span><span class="court">TdP</span></button>
      </div>
      ${LITE ? '' : `<div class="card" data-vsec="oly"><h4>🔎 Vitesse d’attaque d’après ses attaques</h4>
        <div class="sous">Tape un pseudo : SimuOpti lit son historique d’attaques et en déduit sa VA.</div>
        <div class="grid2">
          <label>Joueur<input type="text" data-vo="pseudo" placeholder="pseudo"></label>
          ${CODE ? `<label>Code<input type="password" data-vo="code" value="${esc(cfg.olyCode || '')}" placeholder="Entrez votre code pour déverrouiller" autocomplete="off"></label>` : ''}
        </div>
        <label class="case" style="margin-top:8px"><input type="checkbox" data-vo="une"> Il n’attaque qu’avec une armée <span class="mut">(son enchaînement le plus serré donne alors sa VA)</span></label>
        <div class="row"><button class="b" type="button" data-vogo>🔎 Analyser ses attaques</button></div>
        <div data-vores></div>
        <details class="aide"><summary>Comment c’est calculé</summary><div>Dans l’ordre : VA exacte si elle est connue ; sinon ses <b>départs synchronisés</b> (attaques lancées ensemble vers des cibles à des distances différentes : pour la bonne VA, elles partent à la même minute, quel que soit le nombre d’armées) ; sinon les enchaînements de ses attaques classiques. Un minimum sûr est toujours donné : nombre d’armées en route (au plus VA + 1) et règle de portée au départ.</div></details>
      </div>`}
      <div class="card" data-vsec="mesure"><h4>📏 Mesure exacte sur un trajet vu</h4>
        <div class="sous">Tu as vu une de ses attaques partir et arriver : sa VA se calcule à l’unité.</div>
        <div class="grid2">
          <label>Joueur (attaquant)<input type="text" data-va="pseudo" placeholder="pseudo"></label>
          <label>Distance<input type="text" data-va="d" placeholder="ex. 152,3"></label>
          <label>ou coordonnées attaquant<input type="text" data-va="ca" placeholder="x, y"></label>
          <label>coordonnées cible<input type="text" data-va="cc" placeholder="x, y"></label>
          <label>Durée du trajet<input type="text" data-va="duree" placeholder="ex. 1h 19m 11s"></label>
          <label>ou départ<input type="text" data-va="dep" placeholder="21:04:10"></label>
          <label>arrivée<input type="text" data-va="arr" placeholder="22:23:21"></label>
        </div>
        <div class="row"><button class="b" type="button" data-vago>🎯 Calculer la VA</button></div>
        <div data-vares></div>
        <details class="aide"><summary>Formule</summary><div>Trajet = 637 200 × (1 − e<sup>−distance/350</sup>) × 0,9<sup>VA</sup> secondes : vérifiée à la seconde sur des trajets réels.</div></details>
      </div>
      <div class="card" data-vsec="mesure"><h4>⏱ Temps de trajet</h4>
        <div class="grid2">
          <label>Distance<input type="text" data-tr="d" placeholder="ex. 152,3"></label>
          <label>ou coordonnées départ<input type="text" data-tr="ca" placeholder="x, y"></label>
          <label>coordonnées arrivée<input type="text" data-tr="cc" placeholder="x, y"></label>
          <label>VA<input type="number" data-tr="va" min="0" max="60" value="0"></label>
        </div>
        <div class="row"><button class="b" type="button" data-trgo>⏱ Calculer le trajet</button></div>
        <div data-trres></div>
      </div>
      <div class="card" data-vsec="tdp"><h4>🥚 Technique de ponte (TdP)</h4>
        <div class="sous">Colle deux sondes de la même fourmilière (la plus ancienne en RC 1), ou une seule avec sa TdP connue.</div>
        <div class="grid2" style="grid-template-columns:1fr 1fr">
          <label>RC 1 (le plus ancien)<textarea data-tp="rc1" style="height:90px" placeholder="Colle le 1er rapport…"></textarea></label>
          <label>RC 2<textarea data-tp="rc2" style="height:90px" placeholder="Colle le 2e rapport…"></textarea></label>
        </div>
        <div class="grid2" style="margin-top:8px">
          <label>TdP connue (si un seul RC)<input type="number" data-tp="niv" min="0" max="200" placeholder="ex. 66"></label>
          <label title="Unités de ce type qu’il avait déjà chez lui au moment de partir (lues dans un RC pris avant son départ)">Déjà chez lui au départ<input type="text" data-tp="stock" placeholder="0 = fourmilière vide"></label>
          <label>Unité qu’il pond<select data-tp="unite"><option value="">auto (la plus nombreuse)</option>${Object.keys(Core.TDP_BASE).map((c) => `<option value="${c}">${L(c)}</option>`).join('')}</select></label>
        </div>
        <details class="aide"><summary>Réglages facultatifs (dates, unités évoluées)</summary>
          <div class="grid2" style="margin-top:4px">
            <label>Date du RC 1 si absente<input type="text" data-tp="d1" placeholder="13/11/14 12h48"></label>
            <label>Date du RC 2 si absente<input type="text" data-tp="d2" placeholder="13/11/14 14h10"></label>
            <label>Unités évoluées entre les RC (type)<select data-tp="xc">${Object.keys(Core.EVOL).map((c) => `<option value="${c}">${L(c)}</option>`).join('')}</select></label>
            <label>Nombre évoluées (x)<input type="text" data-tp="x" value="0"></label>
          </div>
        </details>
        <div class="row"><button class="b" type="button" data-tprc>🥚 Calculer</button><button class="b alt" type="button" data-tpnow>⏱ Actualiser la ponte depuis le RC 2</button></div>
        <div data-tpres></div>
        <details class="aide"><summary>Formule</summary><div>Par type d’unité, pondues entre les deux RC : u = (défense au RC 2 + tués au RC 1 + évoluées) − défense au RC 1, puis TdP = 9,4912 × (ln(tp / t) + ln(u)).</div></details>
      </div>
      <div class="card depart-card" data-vsec="tdp"><h4>🕐 Heure de départ de l’adversaire</h4><div data-depart><div class="mut">Colle 2 RC, ou 1 seul RC avec sa TdP, puis « Calculer ».</div></div></div>
      <div class="mut" style="margin:8px 2px">📇 Les VA, TdP et heures de départ calculées ici vont dans la fiche du joueur (onglet Joueurs) ; choisir un joueur remplit cet onglet.</div>`;
  }
  function initVa() {
    const v = panel.querySelector('[data-vue="va"]');
    const q = (s) => v.querySelector(s);
    // sous-onglets : VA d'après OlympusBot, mesure et trajet, TdP et départ
    const sousOnglet = (k) => {
      cfg.vaSous = k; saveCfg(cfg);
      v.querySelectorAll('[data-vs]').forEach((b) => b.classList.toggle('on', b.dataset.vs === k));
      v.querySelectorAll('[data-vsec]').forEach((c) => { c.hidden = c.dataset.vsec !== k; });
    };
    ui.sousOngletVa = sousOnglet;
    v.querySelectorAll('[data-vs]').forEach((b) => b.addEventListener('click', () => sousOnglet(b.dataset.vs)));
    sousOnglet(LITE ? (cfg.vaSous && cfg.vaSous !== 'oly' ? cfg.vaSous : 'mesure') : cfg.vaSous || 'oly');
    const xy = (t) => { const m = String(t || '').match(/(-?\d+(?:[.,]\d+)?)\D+(-?\d+(?:[.,]\d+)?)/); return m ? [parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.'))] : null; };
    const distance = (dTxt, a, b) => {
      const d = parseFloat(String(dTxt || '').replace(/\s/g, '').replace(',', '.'));
      if (d > 0) return d;
      const p = xy(a), r = xy(b);
      return p && r ? Math.hypot(p[0] - r[0], p[1] - r[1]) : null;
    };
    const heure = (t) => { const m = String(t || '').trim().match(/^(\d{1,2})[:hH](\d{2})(?::(\d{2}))?$/); return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0) : null; };
    const reg = () => majFiches();
    // fiche choisie (barre « Fiche », onglet Joueurs, ou joueur travaillé dans un autre onglet) → champs de cet onglet
    ui.remplirVa = (j) => {
      const met = (sel, val) => { const e = v.querySelector(sel); if (e && val != null) e.value = val; };
      met('[data-vo=pseudo]', j.nom); if (q('[data-vo=une]')) q('[data-vo=une]').checked = !!j.uneArmee;
      met('[data-va=pseudo]', j.nom);
      met('[data-tr=va]', j.va ?? 0);
      met('[data-tp=niv]', j.tdp ?? ''); met('[data-tp=stock]', j.stock ?? ''); met('[data-tp=unite]', j.unite || '');
      if (j.rcs) { met('[data-tp=rc1]', j.rcs.rc1 || ''); met('[data-tp=rc2]', j.rcs.rc2 || ''); cfg.tdpRc = { rc1: j.rcs.rc1 || '', rc2: j.rcs.rc2 || '' }; saveCfg(cfg); }
      const cb = v.querySelector('[data-cb=nom]');
      if (cb) { cb.value = j.nom; met('[data-cb=va]', j.va ?? ''); }
      if (ui.vaOly && !memeNom(ui.vaOly.a.pseudo, j.nom)) { q('[data-vores]').innerHTML = ''; ui.vaOly = null; }
    };
    q('[data-vago]').onclick = () => {
      const d = distance(q('[data-va=d]').value, q('[data-va=ca]').value, q('[data-va=cc]').value);
      let s = Core.dureeLue(q('[data-va=duree]').value);
      if (!s) { const a = heure(q('[data-va=dep]').value), b = heure(q('[data-va=arr]').value); if (a != null && b != null) s = b >= a ? b - a : b + 86400 - a; }
      const out = q('[data-vares]');
      if (!d || !s) { out.innerHTML = '<div class="warn">Indique la distance (ou les deux coordonnées) et la durée du trajet (ou les heures de départ et d’arrivée).</div>'; return; }
      const brut = Core.vaDepuisTrajet(d, s), va = Math.max(0, Math.round(brut));
      const ecart = Math.abs(Core.trajet(d, va) - s);
      const nom = q('[data-va=pseudo]').value.trim();
      if (nom) { noterVa(nom, va, 'mesuree'); choisirFiche(nom); if (ui.rcTa.value.trim()) render(ui.rcTa.value, ui.rcOut); }
      out.innerHTML = `<div class="va-res">VA ${va}</div><div>Calcul exact ${f2(brut)} · distance ${f2(d)} · trajet ${Core.dureeTexte(s)}${nom ? ` · enregistrée pour <b>${esc(nom)}</b>` : ''}</div>`
        + (ecart >= 120 ? `<div class="warn">L’écart à un niveau entier est de ${Core.dureeTexte(ecart)} : le trajet n’a peut-être pas été vu depuis son départ.</div>` : '');
    };
    q('[data-trgo]').onclick = () => {
      const d = distance(q('[data-tr=d]').value, q('[data-tr=ca]').value, q('[data-tr=cc]').value);
      const va = parseFloat(q('[data-tr=va]').value) || 0;
      const out = q('[data-trres]');
      if (!d) { out.innerHTML = '<div class="warn">Indique la distance ou les deux coordonnées.</div>'; return; }
      const t = Core.trajet(d, va);
      out.innerHTML = `<table><tr><td>Distance</td><td>${f2(d)}</td></tr><tr><td>Aller (TDC, dôme)</td><td class="big">${Core.dureeTexte(t)}</td></tr><tr><td>Aller-retour (loge)</td><td class="big">${Core.dureeTexte(2 * t)}</td></tr><tr><td>À VA 0</td><td class="mut">${Core.dureeTexte(Core.T0(d))}</td></tr></table>`;
    };
    // ---- VA d'après ses attaques sur OlympusBot
    const voOut = q('[data-vores]'), voNom = q('[data-vo=pseudo]'), voUne = q('[data-vo=une]'), voCode = q('[data-vo=code]');
    const jourHeure = (ms) => new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (voCode) voCode.addEventListener('input', () => { cfg.olyCode = voCode.value.trim(); saveCfg(cfg); const c = v.querySelector('[data-cb=code]'); if (c) c.value = cfg.olyCode; });
    if (voNom) voNom.addEventListener('change', () => { const j = cfg.joueurs[voNom.value.trim().toLowerCase()]; voUne.checked = !!(j && j.uneArmee); });
    const rendreVaOly = (r) => {
      const e = r.est, rel = e.relance, sy = r.synchro, D = Core.dureeTexte;
      const hm = (t) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const titre = `<div class="mut"><b>${esc(r.a.pseudo)}</b>${r.a.ally ? ` <span class="cb-ally">${esc(r.a.ally)}</span>` : ''} · ${fmt(r.a.tdc)} cm²</div>`;
      const g = r.diag, pl = (n, m) => `${n} ${m}${n > 1 ? 's' : ''}`;
      const diag = `<div class="mut" style="margin-top:4px">Historique : ${pl(g.lignes, 'mouvement')} de son terrain — ${pl(g.chasses, 'chasse')}, ${pl(g.pertes, 'perte')} (floods ou attaques subies), ${pl(g.prises, 'prise')} sur un joueur${g.horsCarte ? `, dont ${g.horsCarte} sur des joueurs absents de la carte (ignorées)` : ''}${r.rattrapees ? ` ; <b>${r.rattrapees} « chasse${r.rattrapees > 1 ? 's' : ''} » rattrapée${r.rattrapees > 1 ? 's' : ''}</b> : en réalité des attaques (même montant perdu par sa victime au même relevé)` : ''}.${g.lignes && !g.prises && !r.rattrapees ? ' <b>Son armée n’a pris de terrain à personne</b> : les chasses et les floods reçus ne donnent pas sa VA, seules ses propres attaques la révèlent.' : ''}<br>Page Ennemis : ${esc(g.ennemis)}.</div>`;
      const sur = [r.minArmees ? `${r.armeesEnRoute} armées en route à la fois (au plus VA + 1) : au moins ${r.minArmees}` : '', r.plancher ? `portée au départ (${r.nPlancher} attaques vérifiées) : au moins ${r.plancher}` : ''].filter(Boolean);
      const mini = r.minimum != null ? `<div class="mut" style="margin-top:4px">🛡️ Minimum sûr : <b>${r.minimum}</b> — ${sur.join(' · ')}.</div>` : '';
      let tete;
      if (r.va == null) tete = `<div class="hero"><div class="va-res" style="color:var(--warn)">VA inconnue</div><span class="badge ko">pas assez de données</span></div><div class="pourquoi">Pas assez de lancements groupés ni d’attaques rapprochées dans son historique (${pl(r.attaques.length, 'attaque')}). Mesure-la sur un trajet vu (ci-dessous) ou depuis son heure de départ (Heure de départ de l’adversaire).</div>${mini}${diag}`;
      else if (r.confiance === 'synchro') {
        tete = `<div class="hero"><div class="va-res">VA ${sy.va}${sy.alternative ? ` ou ${sy.alternative.va}` : ''}</div><span class="badge ${sy.confiance === 'bonne' ? 'ok' : 'warn'}">confiance ${sy.confiance}</span></div>
          <div class="pourquoi">Déduite de ses <b>départs synchronisés</b> : ${pl(sy.sessions.length, 'session')} de lancement où des attaques vers des cibles à des distances différentes partent à la même minute.</div>`;
        if (sy.avant) tete += `<div class="note ok">📈 Changement de VA : ${sy.avant.va} jusqu’au ${hm(sy.avant.jusqua)} au moins, ${sy.va} depuis le ${hm(sy.avant.depuis)} au plus tard.</div>`;
        if (sy.alternative) tete += `<div class="note warn">VA ${sy.alternative.va} explique aussi ${pl(sy.alternative.n, 'session')} : l’ordre de ses lancements (quelques minutes d’écart) ne permet pas de trancher.</div>`;
        if (r.conflit) tete += `<div class="note warn">⚠ Plus bas que le minimum sûr (${r.minimum}) : à confirmer.</div>`;
        tete += mini;
      } else {
        const signeVa = ['plancher', 'unearmee-min'].includes(r.confiance) ? '≥ ' : ['exacte', 'unearmee'].includes(r.confiance) ? '' : '≈ ';
        const txt = {
          exacte: '<span class="ok">exacte : VA connue</span>',
          unearmee: `une seule armée : relance ${D(rel && rel.delai)} au plus après son arrivée du ${rel ? jourHeure(rel.de.ts) : ''}, vers ${esc(rel ? rel.a.victime : '')} (trajet ${D(rel && rel.trajet)}) : <b>VA exacte</b> s’il a relancé aussitôt`,
          'unearmee-min': `une seule armée : <b>au moins ${r.va}</b>, il n’a jamais relancé vite (sa relance la plus rapide a pris jusqu’à ${D(rel && rel.delai)})`,
          plancher: `<b>au moins ${r.va}</b> : pas assez de lancements groupés pour la déduire, seul le minimum sûr est connu`,
          bonne: 'estimée d’après les enchaînements de ses attaques classiques (une armée relancée) · confiance bonne',
          moyenne: 'estimée d’après les enchaînements de ses attaques classiques (une armée relancée) · confiance moyenne',
          faible: 'estimée d’après les enchaînements de ses attaques classiques · <span class="warn">confiance faible : à confirmer</span>',
        }[r.confiance] || '';
        const bc = { exacte: ['ok', 'exacte'], unearmee: ['ok', 'une armée'], bonne: ['ok', 'confiance bonne'], moyenne: ['warn', 'confiance moyenne'], faible: ['ko', 'confiance faible'], plancher: ['warn', 'minimum'], 'unearmee-min': ['warn', 'minimum'] }[r.confiance] || ['', ''];
        tete = `<div class="hero"><div class="va-res">VA ${signeVa}${r.va}</div>${bc[1] ? `<span class="badge ${bc[0]}">${bc[1]}</span>` : ''}</div><div class="pourquoi">${txt}</div>`;
        if (r.uneArmee && r.confiance !== 'exacte' && e.suspect != null) tete += `<div class="note warn">⚠ Cet enchaînement est bien plus serré que tous les autres (au plus ${e.suspect}) : s’il avait une 2e armée, décoche la case.</div>`;
        const rem = (r.remontees || []).filter((y) => y.x.parallele);
        if (rem.length && r.vaBrute > r.va) tete += `<div class="note ok">Ramenée de ${r.vaBrute} à ${r.va} : ${rem.length} enchaînement${rem.length > 1 ? 's' : ''} qui l’exigeai${rem.length > 1 ? 'ent' : 't'} viennent d’une 2e armée, lancée juste après une remontée de la cible (${rem.slice(0, 3).map((y) => `${esc(y.x.a.victime)} +${fmt(y.r.cm)} cm² le ${hm(y.r.t)}`).join(', ')}${rem.length > 3 ? '…' : ''}).</div>`;
        if (r.alternative && !['exacte', 'plancher'].includes(r.confiance)) tete += `<div class="note warn">⚠ ${r.alternative.n} enchaînement${r.alternative.n > 1 ? 's' : ''} exige${r.alternative.n > 1 ? 'nt' : ''} VA ${r.alternative.va + 1}. S’il${r.alternative.n > 1 ? 's viennent' : ' vient'} d’une 2e armée, sa VA serait <b>${r.alternative.va}</b> : remontée retrouvée pour ${r.alternative.expliques} sur ${r.alternative.n}.</div>`;
        if (r.confiance !== 'exacte') tete += mini;
        if (!r.uneArmee && r.vaSite == null && e.indices.length && r.confiance !== 'plancher') tete += '<div class="mut">S’il n’attaque qu’avec une armée, coche la case ci-dessus : le résultat est plus précis.</div>';
      }
      const nom = r.a.pseudo, j = cfg.joueurs[nom.toLowerCase()];
      if (r.va != null && r.confiance !== 'plancher') tete += r.confiance === 'exacte' || (j && j.va === r.va) ? `<div class="mut">Enregistrée dans la fiche de <b>${esc(nom)}</b>${j && j.vaSrc && j.vaSrc !== 'exacte' ? ` (${{ estimee: 'estimée', mesuree: 'mesurée', depart: 'mesurée depuis son départ', saisie: 'saisie' }[j.vaSrc] || ''})` : ''}.</div>`
        : `<div class="row"><button class="b alt mini" type="button" data-vosave="${r.va}">Utiliser VA ${r.va} pour ${esc(nom)}</button>${j && j.va != null ? `<span class="mut">VA enregistrée : ${j.va}</span>` : ''}</div>`;
      // départs synchronisés : score par VA et sessions trouvées
      const scores = sy.parVa.filter((x) => x.score > 0);
      const maxS = Math.max(1, ...scores.map((x) => x.score));
      const blocSynchro = `<h4 style="margin-top:6px">Départs synchronisés</h4>
        ${scores.length ? `<table>${scores.map((x) => `<tr style="${x.v === sy.va || (sy.avant && x.v === sy.avant.va) ? 'font-weight:700;color:#fff' : ''}"><td style="width:46px">VA ${x.v}</td><td><span style="display:inline-block;height:9px;width:${Math.round((x.score / maxS) * 160)}px;background:#8a6a3b;border-radius:2px"></span> ${pl(x.n, 'session')}</td></tr>`).join('')}</table>` : '<div class="mut">Aucune session : pas d’attaques lancées ensemble vers des cibles à des distances différentes.</div>'}
        ${sy.sessions.length && sy.confiance !== 'insuffisante' ? `<table style="margin-top:4px"><tr><th>Départ (à VA ${sy.va})</th><th>Attaques : arrivée → cible</th></tr>${sy.sessions.slice(-12).reverse().map((s) => `<tr><td>${hm(s.debut)}</td><td>${s.att.map((x) => `${jourHeure(x.ts)} → ${esc(x.victime)}${x.rattrapee ? ' *' : ''}`).join('<br>')}</td></tr>`).join('')}</table>` : ''}
        <details class="aide"><summary>Comment ça marche</summary><div>Un joueur lance souvent plusieurs attaques dans la même session. Pour la bonne VA, « arrivée − trajet » de ces attaques tombe à la même minute ; pour une mauvaise, ces départs se dispersent. Marche quel que soit le nombre d’armées en route, et une VA ne pouvant que monter, un palier (VA plus haute à partir d’une date) révèle un changement. * attaque relevée comme « Chasse », rattrapée.</div></details>`;
      const lignes = [...e.indices].reverse().filter((x) => x.vaMin > 0 || e.indices.length <= 12).slice(0, 20).map((x) => `
        <tr style="${x.retenu ? 'font-weight:700;color:#fff' : x.parallele || !x.plausible ? 'opacity:.45' : ''}">
          <td>${jourHeure(x.a.ts)}<div class="mut">→ ${esc(x.a.victime)}</div></td>
          <td>${D(x.ecartMin)} à ${D(x.ecartMax)}</td>
          <td>${D(x.base)}</td>
          <td>${x.remontee && x.parallele ? `≥ ${x.vaMin} · 2e armée<div class="mut">${esc(x.a.victime)} +${fmt(x.remontee.cm)} cm² le ${jourHeure(x.remontee.t)}</div>` : !x.plausible || x.parallele ? 'armées en //' : x.vaMin ? '≥ ' + x.vaMin : '—'}</td></tr>`).join('');
      const blocEnch = `<h4 style="margin-top:8px">Enchaînements (${pl(e.attaques, 'attaque')} ${r.uneArmee ? '' : 'classique'}${e.attaques > 1 && !r.uneArmee ? 's' : ''}${r.floods && !r.uneArmee ? `, ${pl(r.floods, 'flood')} d’alliance écarté${r.floods > 1 ? 's' : ''}` : ''})</h4>
        ${lignes ? `<table><tr><th>Arrivée</th><th>Écart possible</th><th>Aller à VA 0</th><th>VA</th></tr>${lignes}</table>` : '<div class="mut">Aucun enchaînement exploitable.</div>'}
        <details class="aide"><summary>Comment ça marche</summary><div>Avec une seule armée, entre deux arrivées il faut au moins le trajet vers la victime suivante. Ne vaut pas pour un passeur : il fait tourner plusieurs armées, d’où l’écart des floods d’alliance.</div></details>`;
      voOut.innerHTML = `${titre}${tete}
        <details class="det"><summary>📋 Détail du calcul</summary>
          ${r.va != null ? diag : ''}
          ${blocSynchro}
          ${blocEnch}
        </details>`;
    };
    const lancerVaOly = async () => {
      const nom = voNom.value.trim();
      if (!nom) { voOut.innerHTML = '<div class="warn">Indique le joueur.</div>'; return; }
      if (voCode) { cfg.olyCode = voCode.value.trim(); saveCfg(cfg); }
      const b = q('[data-vogo]'); b.disabled = true;
      try {
        const r = await analyserVaOly(nom, { uneArmee: voUne.checked, progres: (t) => { voOut.innerHTML = `<div class="mut">${esc(t)}</div>`; } });
        const jj = joueur(r.a.pseudo); jj.nom = r.a.pseudo; // orthographe exacte du site
        if (r.a.ally) jj.ally = r.a.ally;
        if (voUne.checked) jj.uneArmee = true; else delete jj.uneArmee;
        jj.maj = Date.now();
        if (r.confiance === 'exacte') noterVa(r.a.pseudo, r.va, 'exacte');
        else if (r.va != null && ['bonne', 'moyenne', 'unearmee', 'synchro'].includes(r.confiance) && !(r.synchro && r.synchro.alternative && r.confiance === 'synchro') && !(r.uneArmee && r.est.suspect != null) && vaPlusSure(jj, 'estimee')) noterVa(r.a.pseudo, r.va, 'estimee');
        else saveCfg(cfg);
        choisirFiche(r.a.pseudo);
        ui.vaOly = r; rendreVaOly(r);
      } catch (err) { voOut.innerHTML = `<div class="warn">${esc(err.message || err)}</div>`; }
      finally { b.disabled = false; }
    };
    if (voNom) {
      q('[data-vogo]').onclick = lancerVaOly;
      voUne.addEventListener('change', () => { if (ui.vaOly && memeNom(ui.vaOly.a.pseudo, voNom.value.trim())) lancerVaOly(); });
    }
    if (voOut) voOut.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vosave]'); if (!b || !ui.vaOly) return;
      noterVa(ui.vaOly.a.pseudo, +b.dataset.vosave, 'estimee'); reg();
      if (ui.rcTa.value.trim()) render(ui.rcTa.value, ui.rcOut);
      rendreVaOly(ui.vaOly);
    });
    // ---- TdP à partir de deux RC, puis ponte estimée depuis le RC 2
    let dernierTdp = null;
    const tpOut = q('[data-tpres]');
    ['rc1', 'rc2'].forEach((k) => { const t = q(`[data-tp=${k}]`); t.value = (cfg.tdpRc || {})[k] || ''; t.addEventListener('input', () => { cfg.tdpRc = Object.assign(cfg.tdpRc || {}, { [k]: t.value }); saveCfg(cfg); }); });
    const afficherPonte = () => {
      const r = dernierTdp;
      if (!r || !r.best) return '';
      let depuis = (Date.now() - r.t2) / 1000;
      const lignes = r.lignes.filter((l) => l.parSec > 0);
      if (depuis < -15 * 60) return '<div class="warn">L’heure du RC 2 est dans le futur par rapport à ton horloge : vérifie la date.</div>';
      const avance = depuis < 0 ? -depuis : 0;
      depuis = Math.max(0, depuis);
      return `<h4 style="margin-top:8px">Ponte estimée depuis le RC 2 (${Core.dureeTexte(depuis)})</h4>
        <table><tr><th>Unité</th><th>Après le RC 2</th><th>Pondues depuis</th><th>Estimation maintenant</th></tr>
        ${lignes.map((l) => { const p = Math.floor(l.parSec * depuis), ap = r.apresRc2[l.c] || 0; return `<tr><td>${L(l.c)}</td><td>${fmt(ap)}</td><td class="big ok">+${fmt(p)}</td><td class="big">${fmt(ap + p)}</td></tr>`; }).join('')}
        </table>${avance ? `<div class="mut">L’heure du jeu est en avance d’environ ${Core.dureeTexte(avance)} sur ton ordinateur : compté comme 0.</div>` : ''}<div class="mut">Au rythme mesuré entre les deux RC (${lignes.map((l) => `${fmt(l.parSec * 3600)} ${L(l.c)}/h`).join(', ')}), en supposant qu’il ponde toujours la même unité. Heure de ton ordinateur, comparée à l’heure du jeu des rapports.</div>`;
    };
    const dateTexte = (ms) => new Date(ms).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const departOut = q('[data-depart]');
    const afficherDepart = (d, source) => {
      if (d.erreur) { departOut.innerHTML = `<div class="warn">${d.erreur}</div>`; return; }
      const parH = d.rythme * 3600;
      const detail = `${fmt(d.n)} ${L(d.unite)} dans le RC${d.stock ? ` − ${fmt(d.stock)} déjà chez lui` : ''} = ${fmt(d.pondues)} pondues ÷ ${fmt(parH)} ${L(d.unite)}/h (${source})`;
      // Vraisemblance : chez lui il reste d'autres unités → il n'est pas parti avec tout, son stock de départ est inconnu.
      // Et une ponte de plus de 24 h sans interruption est très improbable.
      const douteux = !d.stock && (d.autres.length > 0 || d.ecoule > 24 * 3600);
      let h;
      if (douteux) {
        h = `<div class="va-res" style="color:#f0b35a">Départ non datable avec ce RC</div>
          <div>Il faudrait ${Core.dureeTexte(d.ecoule)} de ponte non-stop pour obtenir ses ${fmt(d.n)} ${L(d.unite)} : il en avait donc <b>déjà chez lui</b> quand il est parti.</div>
          ${d.autres.length ? `<div>D’ailleurs il reste ${d.autres.map(([c, n]) => `${fmt(n)} ${L(c)}`).join(', ')} chez lui : il n’est pas parti avec toute son armée.</div>` : ''}
          <div class="mut">Borne seulement : parti après le ${dateTexte(d.depart)}. ${detail}.</div>
          <div class="ok" style="margin-top:4px">➜ Pour le dater : indique dans « Déjà chez lui au départ » ses ${L(d.unite)} lues dans un RC pris <b>avant</b> son départ, puis relance le calcul.</div>`;
      } else {
        h = `<div class="va-res">Parti ${dateTexte(d.depart)}</div>
          <div>Il y a ${Core.dureeTexte(d.ecoule)} avant le rapport du ${dateTexte(d.t)}${d.nom ? ` · ${esc(d.nom)}` : ''}.</div>
          <div class="mut">${detail}.</div>`;
        if (Date.now() > d.depart) h += `<div class="mut">Soit il y a ${Core.dureeTexte((Date.now() - d.depart) / 1000)} à l’heure actuelle.</div>`;
        h += `<div class="mut">Suppose ${d.stock ? `qu’il avait ${fmt(d.stock)} ${L(d.unite)} chez lui au départ` : 'qu’il est parti avec toute son armée (fourmilière vide)'} et qu’il pond la même unité depuis. Précision : <b>± ${Math.ceil(1 / d.rythme)} s</b>, le temps de ponte d’une unité (le RC donne l’heure exacte du combat).</div>`;
      }
      ui.departCalc = douteux ? null : { depart: d.depart, precision: 1 / d.rythme };
      if (!douteux && d.nom) { Object.assign(joueur(d.nom), { depart: d.depart, maj: Date.now() }); saveCfg(cfg); majFiches(); }
      // cibles à portée : départ calculé (modifiable), ou saisi à la main si le RC ne permet pas de le dater
      const j = d.nom ? cfg.joueurs[String(d.nom).toLowerCase()] || {} : {};
      const pad = (v) => String(v).padStart(2, '0');
      const dd = new Date(d.depart);
      const depTxt = douteux ? '' : `${pad(dd.getDate())}/${pad(dd.getMonth() + 1)}/${String(dd.getFullYear()).slice(2)} ${pad(dd.getHours())}h${pad(dd.getMinutes())}:${pad(dd.getSeconds())}`;
      if (!LITE) h += `<div class="cibles"><h4>🎯 Qui peut-il toucher ?</h4>
        <div class="mut">Membres de ton alliance et de la sienne qu’il pouvait flooder à son départ, l’heure où il arrive sur chacun, et quand lancer pour le prendre dans la minute où son armée est chez lui.</div>
        <div class="grid2" style="margin-top:6px">
          <label>Attaquant<input type="text" data-cb="nom" value="${esc(d.nom || '')}" placeholder="pseudo"></label>
          <label>Heure de départ<input type="text" data-cb="dep" value="${depTxt}" placeholder="27/10/26 21h04:10"></label>
          <label>Sa VA<input type="number" data-cb="va" min="0" max="60" value="${j.va ?? ''}" placeholder="inconnue"></label>
          <label>Ma VA<input type="number" data-cb="mava" min="0" max="60" value="${cfg.maVa ?? ''}" placeholder="pour l’heure de lancement"></label>
          <label>Mon trajet jusqu’à lui (affiché par le jeu)<input type="text" data-cb="montrajet" placeholder="ex. 49m 33s (facultatif)"></label>
          ${CODE ? `<label>Code<input type="password" data-cb="code" value="${esc(cfg.olyCode || '')}" placeholder="Entrez votre code pour déverrouiller" autocomplete="off"></label>` : ''}
        </div>
        <div class="row"><button class="b" type="button" data-cbgo>🎯 Lister les cibles à portée</button><button class="b alt" type="button" data-cbva>📏 Mesurer sa VA (1re prise après son départ)</button></div>
        <div data-cbvares></div>
        <div data-cbres></div></div>`;
      departOut.innerHTML = h;
    };
    departOut.addEventListener('click', async (e) => {
      const bm = e.target.closest('[data-cbmode]');
      if (bm && ui.cibles) {
        cfg.cbMode = bm.dataset.cbmode; saveCfg(cfg);
        ui.cibles.opts.mode = cfg.cbMode;
        departOut.querySelector('[data-cbres]').innerHTML = rendreCibles(ui.cibles.r, ui.cibles.opts);
        return;
      }
      if (e.target.closest('[data-cbvause]')) {
        const champ = departOut.querySelector('[data-cb=va]'), n = departOut.querySelector('[data-cb=nom]').value.trim();
        champ.value = e.target.closest('[data-cbvause]').dataset.cbvause;
        if (n) { noterVa(n, +champ.value, 'depart'); reg(); }
        return;
      }
      if (e.target.closest('[data-cbva]')) {
        const vout = departOut.querySelector('[data-cbvares]');
        const nom = departOut.querySelector('[data-cb=nom]').value.trim();
        const depart = Core.dateRc(departOut.querySelector('[data-cb=dep]').value.trim().replace(/(\d{1,2}h\d{2}):(\d{2})/, '$1m$2'));
        if (!nom || !depart) { vout.innerHTML = '<div class="warn">Indique l’attaquant et son heure de départ.</div>'; return; }
        const champCode = departOut.querySelector('[data-cb=code]');
        if (champCode) { cfg.olyCode = champCode.value.trim(); saveCfg(cfg); }
        const calc = ui.departCalc && Math.abs(ui.departCalc.depart - depart) < 1000 ? ui.departCalc : null;
        const prec = calc ? calc.precision : 0;
        vout.innerHTML = '<div class="mut">Lecture du traceur…</div>';
        try {
          const { a, suite } = await vaDepuisDepart(nom, depart, prec);
          if (!suite.length) { vout.innerHTML = `<div class="warn">Aucune prise de terrain de ${esc(a.pseudo)} relevée depuis ce départ : son attaque n’est pas encore arrivée, ou ce n’était pas une attaque de TDC.</div>`; return; }
          const D = Core.dureeTexte;
          const ligne = (x, i) => {
            const r = x.r;
            const quand = `prise relevée ${x.debut != null && x.debut < x.ts ? `entre ${hms(x.debut)} et ${hms(x.ts)}` : `à ${hms(x.ts)} (scan précédent inconnu)`}`;
            if (!r || !r.ok) return `<div class="mut">${i ? 'Puis' : '1re prise'} : ${fmt(x.cm)} cm² pris à ${esc(x.victime)}, ${quand} : ${r && r.max < 0 ? 'trop tard pour venir de ce départ (trajet plus long qu’à VA 0) : une autre sortie' : 'incompatible avec ce départ'}.</div>`;
            const va = r.min === r.max ? `<b>VA ${r.min}</b>` : `<b>VA ${r.min} à ${r.max}</b>`;
            return `<div${i ? ' class="mut"' : ''}>${i ? 'Puis' : '1re prise'} : ${fmt(x.cm)} cm² pris à <b>${esc(x.victime)}</b> (distance ${f2(x.d)}), ${quand} → arrivée entre ${hms(r.arrMin)} et ${hms(r.arrMax)}, trajet de ${D(r.tMin)} à ${D(r.tMax)} : ${va}${r.min !== r.max ? ' (scans trop espacés pour trancher)' : ''}${!i ? ` <button class="b alt mini" type="button" data-cbvause="${r.min === r.max ? r.min : r.max}">Utiliser ${r.min === r.max ? r.min : r.max}</button>` : ''}</div>`;
          };
          const r0 = suite[0].r;
          vout.innerHTML = `<div class="cb-tete">${suite.map(ligne).join('')}
            <div class="mut" style="margin-top:4px">Si sa 1re prise vient d’une autre armée (partie plus tôt), la VA est fausse : vérifie qu’elle concorde avec « Analyser ses attaques ». Arrivée = prise effective − 70 à 129 s (fin de la minute qui suit l’arrivée + 9 s)${prec ? `, départ à ± ${Math.ceil(prec)} s` : ''}.${r0 && r0.ok && r0.min !== r0.max ? ' Avec une fourchette, « Utiliser » prend la plus haute : son armée arrive alors au plus tôt.' : ''}</div></div>`;
        } catch (err) { vout.innerHTML = `<div class="warn">${esc(err.message || err)}</div>`; }
        return;
      }
      if (!e.target.closest('[data-cbgo]')) return;
      const out = departOut.querySelector('[data-cbres]');
      const nom = departOut.querySelector('[data-cb=nom]').value.trim();
      const brut = departOut.querySelector('[data-cb=dep]').value.trim();
      const depart = Core.dateRc(brut.replace(/(\d{1,2}h\d{2}):(\d{2})/, '$1m$2'));
      const vaTxt = departOut.querySelector('[data-cb=va]').value.trim();
      const va = vaTxt === '' ? null : parseFloat(vaTxt);
      if (!nom || !depart) { out.innerHTML = '<div class="warn">Indique l’attaquant et son heure de départ (jj/mm/aa hhhmm, secondes facultatives).</div>'; return; }
      if (va != null && va !== (ficheDe(nom) || {}).va) noterVa(nom, va, 'saisie');
      if (ficheDe(nom)) choisirFiche(nom);
      const maTxt = departOut.querySelector('[data-cb=mava]').value.trim();
      cfg.maVa = maTxt === '' ? null : parseFloat(maTxt);
      const champCode = departOut.querySelector('[data-cb=code]');
      if (champCode) cfg.olyCode = champCode.value.trim();
      saveCfg(cfg);
      out.innerHTML = '<div class="mut">Lecture de la carte et du traceur…</div>';
      const calc = ui.departCalc && Math.abs(ui.departCalc.depart - depart) < 1000 ? ui.departCalc : null;
      const opts = { mode: cfg.cbMode || 'dome', monTrajet: Core.dureeLue(departOut.querySelector('[data-cb=montrajet]').value), precision: calc ? calc.precision : null };
      try { const r = await ciblesAuDepart({ pseudo: nom, depart, va, moi: cfg.pseudo, maVa: cfg.maVa }); ui.cibles = { r, opts }; out.innerHTML = rendreCibles(r, opts); }
      catch (err) { out.innerHTML = `<div class="warn">${esc(err.message || err)}</div>`; }
    });
    q('[data-tprc]').onclick = () => {
      // un seul RC + TdP saisie : uniquement l'heure de départ
      const rc1 = q('[data-tp=rc1]').value, rc2 = q('[data-tp=rc2]').value;
      const unite = q('[data-tp=unite]').value || null;
      if (!rc2.trim() || !rc1.trim()) {
        const seul = rc1.trim() ? rc1 : rc2;
        const niv = parseFloat(q('[data-tp=niv]').value);
        tpOut.innerHTML = '';
        if (!seul.trim()) { departOut.innerHTML = '<div class="warn">Colle au moins un RC.</div>'; return; }
        const d = Core.departDepuisRc(seul, { tdp: isFinite(niv) ? niv : undefined, unite, stock: Core.toInt(q('[data-tp=stock]').value), date: Core.dateRc(q(`[data-tp=${rc1.trim() ? 'd1' : 'd2'}]`).value) });
        if (!d.erreur && d.nom) {
          const j = joueur(d.nom);
          if (isFinite(niv)) j.tdp = niv;
          Object.assign(j, { unite: d.unite, stock: d.stock || undefined, rcs: { rc1: seul, rc2: '' }, maj: Date.now() });
          saveCfg(cfg); choisirFiche(d.nom);
        }
        afficherDepart(d, `TdP ${f2(niv)} saisie`);
        return;
      }
      const x = Core.toInt(q('[data-tp=x]').value);
      const r = Core.tdpDepuisRcs(q('[data-tp=rc1]').value, q('[data-tp=rc2]').value, {
        t1: Core.dateRc(q('[data-tp=d1]').value), t2: Core.dateRc(q('[data-tp=d2]').value),
        evol: x ? { [q('[data-tp=xc]').value]: x } : {},
      });
      if (r.erreur) { tpOut.innerHTML = `<div class="warn">${r.erreur}</div>`; dernierTdp = null; return; }
      dernierTdp = r;
      let h = `<div class="mut">Écart entre les deux RC : ${Core.dureeTexte(r.t)}${r.nom ? ` · joueur ${esc(r.nom)}` : ''}</div>`;
      if (!r.memeJoueur) h += '<div class="warn">⚠ Les deux RC ne visent pas le même joueur.</div>';
      h += `<table><tr><th>Unité</th><th>RC 1</th><th>Tués RC 1</th><th>RC 2</th><th>Pondues</th><th>TdP</th></tr>
        ${r.lignes.map((l) => `<tr${r.best && l.c === r.best.c ? ' style="background:#2f4a2a"' : ''}><td>${L(l.c)}</td><td>${fmt(l.p1)}</td><td>${fmt(l.k)}</td><td>${fmt(l.p2)}</td><td>${l.u > 0 ? '+' + fmt(l.u) : fmt(l.u)}</td><td>${l.tdp != null ? f2(l.tdp) : '—'}</td></tr>`).join('')}</table>`;
      if (r.best) {
        const niv = Math.round(r.best.tdp);
        h += `<div class="va-res">TdP ${niv}</div><div>D’après les ${fmt(r.best.u)} ${L(r.best.c)} pondues en ${Core.dureeTexte(r.t)} (calcul exact ${f2(r.best.tdp)}).</div>`;
        if (r.nom) {
          const st = Core.toInt(q('[data-tp=stock]').value);
          Object.assign(joueur(r.nom), { tdp: niv, unite: unite || r.best.c, stock: st || undefined, rcs: { rc1: q('[data-tp=rc1]').value, rc2: q('[data-tp=rc2]').value }, maj: Date.now() });
          saveCfg(cfg); choisirFiche(r.nom);
          if (ui.rcTa.value.trim()) render(ui.rcTa.value, ui.rcOut); h += `<div class="mut">Enregistrée dans la fiche de <b>${esc(r.nom)}</b>.</div>`;
        }
      } else h += '<div class="warn">Aucune unité n’a augmenté entre les deux RC : pas de ponte mesurable (ou unités évoluées à indiquer dans les réglages).</div>';
      tpOut.innerHTML = h + `<div data-ponte>${afficherPonte()}</div>`;
      // heure de départ : rythme mesuré entre les deux RC, appliqué aux unités trouvées au RC 1
      if (r.best) {
        const u = unite && r.lignes.some((l) => l.c === unite && l.parSec > 0) ? unite : r.best.c;
        const ligne = r.lignes.find((l) => l.c === u);
        afficherDepart(Core.departDepuisRc(q('[data-tp=rc1]').value, { rythme: ligne.parSec, unite: u, date: r.t1, stock: Core.toInt(q('[data-tp=stock]').value) }), 'rythme mesuré entre les deux RC');
      } else afficherDepart({ erreur: 'Pas de ponte mesurée entre les deux RC : impossible de dater le départ.' });
    };
    q('[data-tpnow]').onclick = () => { const z = tpOut.querySelector('[data-ponte]'); if (z) z.innerHTML = afficherPonte(); else q('[data-tprc]').click(); };
    reg();
  }

  /* ============================ Onglet Joueurs (fiches) ============================ */
  function vueFiches() {
    return `
      <div class="card"><h4>📇 Fiches joueurs</h4>
        <div class="sous">Remplies toutes seules par les autres onglets. Touche un joueur pour le choisir : sa fiche remplit ${LITE ? '' : 'le simulateur et '}l’onglet VA &amp; TdP.</div>
        <div class="row"><input type="text" data-fi="filtre" placeholder="🔍 Filtrer…" style="width:170px"><span class="mut" data-fi="nb"></span></div>
        <div data-fi="liste"></div>
      </div>
      <div data-fi="detail"></div>`;
  }
  function initFiches() {
    const v = panel.querySelector('[data-vue="fiches"]');
    const q = (s) => v.querySelector(s);
    const filtre = q('[data-fi=filtre]');
    const champs = [['armes', 'Armes'], ['bouclier', 'Bouclier'], ['dome', 'Dôme'], ['loge', 'Loge'], ['va', 'VA'], ['tdp', 'TdP'], ['stock', 'Déjà chez lui au départ']];
    const srcVa = { exacte: 'exacte', mesuree: 'mesurée sur un trajet', depart: 'mesurée depuis son départ', estimee: 'estimée d’après ses attaques', saisie: 'saisie à la main' };
    ui.rendreJoueurs = () => {
      const f = filtre.value.trim().toLowerCase();
      const js = Object.values(cfg.joueurs).filter((j) => !f || j.nom.toLowerCase().includes(f)).sort((a, b) => (b.maj || 0) - (a.maj || 0));
      q('[data-fi=nb]').textContent = `${Object.keys(cfg.joueurs).length} fiche${Object.keys(cfg.joueurs).length > 1 ? 's' : ''}`;
      const actif = (cfg.actif || '').toLowerCase();
      q('[data-fi=liste]').innerHTML = js.length ? `<table class="fi-tab"><tr><th>Joueur</th><th>A</th><th>B</th><th>D</th><th>L</th><th>VA</th><th>TdP</th><th>Mise à jour</th></tr>
        ${js.map((j) => `<tr class="${j.nom.toLowerCase() === actif ? 'on' : ''}" data-fichoix="${esc(j.nom)}"><td><span class="nomf">${esc(j.nom)}</span>${j.ally ? ` <span class="cb-ally">${esc(j.ally)}</span>` : ''}</td>
          ${NIVEAUX.map((k) => `<td>${j[k] == null ? '<span class="mut">—</span>' : j.sup && j.sup[k] ? `<span class="niv warn">≈${j[k]}</span>` : `<span class="niv ok">${j[k]}</span>`}</td>`).join('')}
          <td>${j.va != null ? `<b>${j.va}</b>` : '<span class="mut">—</span>'}</td><td>${j.tdp != null ? `<b>${j.tdp}</b>` : '<span class="mut">—</span>'}</td><td class="mut">${j.maj ? dateCourte(j.maj) : '—'}</td></tr>`).join('')}</table>`
        : '<div class="mut">Aucune fiche. Analyse un RC, calcule une VA ou une TdP : la fiche du joueur se crée toute seule.</div>';
      const j = ficheDe(cfg.actif), d = q('[data-fi=detail]');
      if (!j) { d.innerHTML = ''; return; }
      if (d.contains(racine.activeElement)) return; // saisie en cours dans la fiche
      d.innerHTML = `<div class="card"><h4>📇 ${esc(j.nom)}${j.ally ? ` <span class="cb-ally">${esc(j.ally)}</span>` : ''}</h4>
        <div class="grid2 fi-edit">${champs.map(([k, t]) => `<label>${t}${j.sup && j.sup[k] ? ' <span class="warn">(supposé)</span>' : ''}<input type="text" inputmode="numeric" data-fik="${k}" value="${j[k] ?? ''}" placeholder="?"></label>`).join('')}
          <label>Unité qu’il pond<select data-fik="unite"><option value="">?</option>${Object.keys(Core.TDP_BASE).map((c) => `<option value="${c}"${j.unite === c ? ' selected' : ''}>${L(c)}</option>`).join('')}</select></label>
          <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-fik="uneArmee" style="width:auto!important"${j.uneArmee ? ' checked' : ''}>une seule armée</label></div>
        <div class="mut" style="margin-top:6px">
          ${j.va != null ? `VA ${srcVa[j.vaSrc] || 'enregistrée'}.<br>` : ''}
          ${j.niveauxT ? `Niveaux lus dans les RC jusqu’au ${dateCourte(j.niveauxT)}${j.sup && Object.keys(j.sup).length ? ' (≈ = supposé)' : ''}.<br>` : ''}
          ${j.defense ? `Dernière défense vue le ${dateCourte(j.defense.t)} : ${armyStr(Object.entries(j.defense.armee))}.<br>` : 'Aucune défense connue (elle se remplit quand il est défenseur dans un RC analysé).<br>'}
          ${j.depart ? `Dernier départ calculé : ${dateCourte(j.depart)}.<br>` : ''}
          ${j.rcs ? 'RC de ponte enregistrés : ils reviennent dans l’onglet VA &amp; TdP quand tu le choisis.' : ''}</div>
        <div class="row">
          ${LITE ? '' : '<button class="b" type="button" data-fiva="sim">⚔️ Simulateur</button>'}<button class="b" type="button" data-fiva="va">🕐 VA &amp; TdP</button>
          <button class="b alt" type="button" data-ficopie>📋 Copier la ligne</button><button class="b alt" type="button" data-fisuppr>🗑 Supprimer la fiche</button></div>
        <pre class="copie">${esc(ligneFiche(j))}</pre></div>`;
    };
    filtre.addEventListener('input', () => ui.rendreJoueurs());
    v.addEventListener('click', (e) => {
      const t = e.target, j = ficheDe(cfg.actif);
      const ch = t.closest('[data-fichoix]');
      if (ch) { choisirFiche(ch.dataset.fichoix); return; }
      if (!j) return;
      if (t.dataset.fiva) { choisirFiche(j.nom); onglet(t.dataset.fiva); }
      if (t.matches('[data-ficopie]')) copier(ligneFiche(j), t);
      if (t.matches('[data-fisuppr]')) {
        // deux clics : pas de boîte de dialogue dans l'application
        if (!t.dataset.ok) { t.dataset.ok = '1'; t.textContent = 'Confirmer la suppression ?'; setTimeout(() => { if (t.isConnected) { delete t.dataset.ok; t.textContent = '🗑 Supprimer la fiche'; } }, 4000); return; }
        delete cfg.joueurs[j.nom.toLowerCase()]; cfg.actif = null; saveCfg(cfg); majFiches();
      }
    });
    v.addEventListener('change', (e) => {
      const k = e.target.dataset.fik, j = ficheDe(cfg.actif);
      if (!k || !j) return;
      if (k === 'uneArmee') { if (e.target.checked) j.uneArmee = true; else delete j.uneArmee; }
      else if (k === 'unite') { if (e.target.value) j.unite = e.target.value; else delete j.unite; }
      else {
        const txt = e.target.value.trim(), n = k === 'stock' ? Core.toInt(txt) : parseFloat(txt.replace(',', '.'));
        if (txt === '' || !isFinite(n)) delete j[k]; else j[k] = n;
        if (j.sup) delete j.sup[k];
        if (k === 'va') j.vaSrc = 'saisie';
      }
      j.maj = Date.now(); saveCfg(cfg);
      e.target.blur(); choisirFiche(j.nom);
    });
    // barre « Fiche » : choisir un joueur existant, ou créer sa fiche en tapant un nouveau pseudo
    const inp = panel.querySelector('[data-fiche]');
    inp.addEventListener('change', () => {
      const nom = inp.value.trim();
      if (!nom) { cfg.actif = null; saveCfg(cfg); majFiches(); return; }
      const j = ficheDe(nom) || Object.assign(joueur(nom), { maj: Date.now() });
      inp.blur(); choisirFiche(j.nom);
    });
    inp.addEventListener('focus', () => inp.select());
    majFiches();
  }

  /* Ouverture : raccourci Alt+Maj+S, menu Tampermonkey, ou bouton flottant si tu l'actives. */
  function demarrer() {
    if (APP) { ouvrir(); return; }
    if (cfg.ouvert) ouvrir(); else if (cfg.bouton) monter();
  }
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyS') { e.preventDefault(); basculer(); }
  }, true);
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚔️ Ouvrir / fermer SimuOpti (Alt+Maj+S)', basculer);
    GM_registerMenuCommand('Afficher / masquer le bouton flottant', () => {
      cfg.bouton = !cfg.bouton; saveCfg(cfg);
      const ouvert = estOuvert();
      demonter();
      if (ouvert) ouvrir(); else if (cfg.bouton) monter();
    });
  }
  if (document.body) demarrer(); else window.addEventListener('DOMContentLoaded', demarrer);
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
