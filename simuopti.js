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
      const jsnMarge = Math.ceil(jsn * (1 + (my.tampon == null ? TAMPON_DEFAUT : my.tampon) / 100));
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

    /** Marge tampon par défaut (%) ajoutée au minimum de JSN : l'adversaire pond entre le RC et l'arrivée. */
    const TAMPON_DEFAUT = 20;

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
      const jsnMarge = Math.ceil(jsnNeed * (1 + (my.tampon == null ? TAMPON_DEFAUT : my.tampon) / 100));
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

    /** Noms des unités : singulier, pluriel. */
    const NOMS = {
      JSN: ['Jeune Soldate Naine', 'Jeunes Soldates Naines'], SN: ['Soldate Naine', 'Soldates Naines'], NE: ['Naine d’Elite', 'Naines d’Elites'],
      JS: ['Jeune Soldate', 'Jeunes Soldates'], S: ['Soldate', 'Soldates'], C: ['Concierge', 'Concierges'], CE: ['Concierge d’élite', 'Concierges d’élites'],
      A: ['Artilleuse', 'Artilleuses'], AE: ['Artilleuse d’élite', 'Artilleuses d’élites'], SE: ['Soldate d’élite', 'Soldates d’élites'],
      T: ['Tank', 'Tanks'], TE: ['Tank d’élite', 'Tanks d’élites'], Tu: ['Tueuse', 'Tueuses'], TuE: ['Tueuse d’élite', 'Tueuses d’élites'],
    };

    /* ---------------- VA (formule de FourmiWatch) et TdP ---------------- */
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


    const api = { TAMPON_DEFAUT, rythmePonte, departDepuisRc, dateRc, tdpDepuisRcs, NOMS, T0, trajet, vaDepuisTrajet, dureeLue, dureeTexte, tdp, TDP_BASE, toInt,
      LAB, UNITS, EVOL, GAIN, parseArmyLoose, optimize, parseReports, analyseCombat, analyseText, xpPct, combos, plan, players, sumBy };
    return api;
  })();

  if (typeof window === 'undefined') { module.exports = Core; return; }

  /* =====================================================================
   *  INTERFACE
   * ===================================================================== */
  const KEY = 'simuOpti';
  const VERSION = '1.14.0'; // aligné sur @version
  // Mode application (APK Android) : la page index.html de l'appli pose ce drapeau avant de charger le script
  const APP = window.SIMUOPTI_APP === true;
  // Page web légère : ni simulateur ni requêtes en ligne (la page pose ce drapeau en plus du mode application)
  const LITE = window.SIMUOPTI_LITE === true;
  const CODE = APP && !LITE; // fonctions en ligne déverrouillées par un code : APK et exe seulement
  const DEFAUT = { armes: 0, bouclier: 0, cochenille: 0, secu: 1.02, tampon: Core.TAMPON_DEFAUT, pseudo: '', xpUnits: ['T'], onglet: 'rc', joueurs: {} };
  // Stockage Tampermonkey : hors de portée des scripts du site (contrairement au localStorage de fourmizzz.fr)
  const GM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const loadCfg = () => {
    let v = null;
    try { v = GM ? GM_getValue(KEY, null) : null; } catch (e) { v = null; }
    if (!v) {
      // reprise des versions précédentes, qui écrivaient dans le localStorage du site
      try { const old = localStorage.getItem(KEY) || localStorage.getItem('simuoptiAncien'); if (old) v = JSON.parse(old); } catch (e) { /* illisible */ }
    }
    if (GM) {
      try { if (v) GM_setValue(KEY, v); localStorage.removeItem(KEY); localStorage.removeItem('simuoptiAncien'); } catch (e) { /* rien à nettoyer */ }
    }
    return Object.assign({}, DEFAUT, v || {});
  };
  const saveCfg = (c) => {
    try { if (GM) GM_setValue(KEY, JSON.parse(JSON.stringify(c))); else localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* stockage indisponible */ }
  };
  let cfg = loadCfg();
  if (!cfg.joueurs) cfg.joueurs = {};
  if (!cfg.tamponV2) { if (cfg.tampon == null || cfg.tampon === 5) cfg.tampon = Core.TAMPON_DEFAUT; cfg.tamponV2 = true; saveCfg(cfg); }

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
    if (!sauf.includes('va') && ui.remplirVa) ui.remplirVa(j);
    majFiches();
  }
  /** Barre « Fiche », info du simulateur et onglet Joueurs. */
  function majFiches() {
    if (!panel) return;
    const js = Object.values(cfg.joueurs).sort((a, b) => (b.maj || 0) - (a.maj || 0));
    const dl = panel.querySelector('#simuopti-fiches');
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
  /* ---- Palette brun et or ---- */
  #simuopti-ui,#simuopti-ui-btn{--fond:#18120d;--carte:#221a13;--carte2:#2b2118;--champ:#110d09;--ligne:#3b2e21;--ligne2:#5a4630;
    --or:#f3d9a4;--bronze:#c08a45;--bronze2:#8a6a3b;--texte:#eee3d1;--mut:#a8997f;--ok:#8fd18f;--okf:#1f3a1d;--warn:#f0b35a;--warnf:#3a2a14;--ko:#ff8a6b;--kof:#3a1a14}
  #simuopti-ui-btn{position:fixed;left:12px;bottom:12px;z-index:2147483646;background:var(--carte2);color:var(--or);border:1px solid var(--bronze2);border-radius:20px;padding:7px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 10px #0008}
  #simuopti-ui{position:fixed;left:12px;bottom:52px;z-index:2147483647;width:min(600px,calc(100vw - 24px));max-height:calc(100vh - 70px);display:none;flex-direction:column;background:var(--fond);color:var(--texte);border:1px solid var(--bronze2);border-radius:12px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 30px #000b}
  #simuopti-ui.open{display:flex}
  #simuopti-ui.large{width:min(1000px,calc(100vw - 24px))}
  #simuopti-ui{resize:both;overflow:hidden;min-width:320px;min-height:220px}
  #simuopti-ui.flotte{bottom:auto}
  #simuopti-ui.max{left:8px!important;top:8px!important;bottom:auto!important;width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important;max-height:none!important;resize:none}
  #simuopti-ui.app{left:0!important;top:0!important;bottom:auto!important;width:100vw!important;height:100vh!important;height:100dvh!important;max-height:none!important;border:0;border-radius:0;resize:none;box-shadow:none;padding-top:env(safe-area-inset-top)}
  #simuopti-ui.app input,#simuopti-ui.app select,#simuopti-ui.app textarea{font-size:16px}
  /* ---- En-tête et onglets ---- */
  #simuopti-ui header{display:flex;justify-content:space-between;align-items:center;padding:9px 12px 4px;cursor:move;user-select:none}
  #simuopti-ui header .titre{display:flex;align-items:baseline;gap:8px;font-weight:800;font-size:15px;color:var(--or);letter-spacing:.2px}
  #simuopti-ui header .titre small{font-size:11px;font-weight:600;color:var(--mut)}
  #simuopti-ui header .titre .ally{font-size:10px;font-weight:800;color:var(--fond);background:var(--bronze);border-radius:4px;padding:1px 5px}
  #simuopti-ui.max header,#simuopti-ui.app header{cursor:default}
  #simuopti-ui header button{background:none;border:0;color:var(--texte);font-size:18px;cursor:pointer}
  #simuopti-ui header .ctl{display:flex;gap:2px}
  #simuopti-ui header .ctl button{width:28px;height:26px;border-radius:6px;font-size:15px;line-height:1}
  #simuopti-ui header .ctl button:hover{background:var(--carte2)}
  #simuopti-ui.app header .ctl,#simuopti-ui.app [data-page]{display:none}
  #simuopti-ui nav{display:flex;gap:4px;padding:4px 10px 0;border-bottom:1px solid var(--ligne)}
  #simuopti-ui nav button{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;background:transparent;color:var(--mut);border:0;border-bottom:3px solid transparent;padding:8px 6px 7px;font:700 13px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
  #simuopti-ui nav button .ico{font-size:15px}
  #simuopti-ui nav button:hover{color:var(--texte)}
  #simuopti-ui nav button.on{color:var(--or);border-bottom-color:var(--bronze)}
  @media (max-width:520px){#simuopti-ui nav button{font-size:12px;padding:8px 2px 7px;gap:3px}#simuopti-ui .long{display:none}}
  @media (min-width:521px){#simuopti-ui .court{display:none}}
  /* ---- Barre « joueur actif » ---- */
  #simuopti-ui .fbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;padding:7px 12px;border-bottom:1px solid var(--ligne);background:var(--carte);font-size:12px}
  #simuopti-ui .fbar .lib{color:var(--mut);font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.5px}
  #simuopti-ui .fbar input{width:150px!important;flex:none;font-weight:700}
  #simuopti-ui .fbar [data-fres]{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:4px}
  #simuopti-ui .pill{display:inline-flex;align-items:baseline;gap:3px;padding:1px 7px;border-radius:10px;background:var(--champ);border:1px solid var(--ligne);font-size:12px;white-space:nowrap}
  #simuopti-ui .pill i{font-style:normal;color:var(--mut);font-size:10px;font-weight:700}
  #simuopti-ui .pill.inc{color:var(--mut)}
  #simuopti-ui .pill.sup{border-color:#6b4e22;color:var(--warn)}
  #simuopti-ui .sep{display:none}
  @media (max-width:520px){#simuopti-ui .fbar [data-fres]{flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto;gap:3px}#simuopti-ui .fbar .pill{padding:1px 6px}}
  /* ---- Corps ---- */
  #simuopti-ui .body{flex:1;min-height:0;overflow:auto;padding:10px 12px 16px}
  #simuopti-ui .vue[hidden],#simuopti-ui [data-vsec][hidden]{display:none}
  #simuopti-ui .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
  #simuopti-ui label{display:flex;gap:4px;align-items:center;font-size:12px;color:var(--mut)}
  #simuopti-ui input[type=number],#simuopti-ui input[type=text],#simuopti-ui input[type=password],#simuopti-ui select{width:64px;background:var(--champ);color:var(--texte);border:1px solid var(--ligne2);border-radius:6px;padding:4px 6px;font:13px system-ui,sans-serif;outline:none}
  #simuopti-ui input[type=text]{width:110px}
  #simuopti-ui input:focus,#simuopti-ui select:focus,#simuopti-ui textarea:focus{border-color:var(--bronze);box-shadow:0 0 0 2px #c08a4533}
  #simuopti-ui textarea{width:100%;box-sizing:border-box;height:110px;background:var(--champ);color:var(--texte);border:1px solid var(--ligne2);border-radius:8px;padding:7px;font:12px ui-monospace,Consolas,monospace;outline:none}
  #simuopti-ui .b{display:inline-flex;align-items:center;gap:5px;background:var(--bronze);color:#1a120a;border:0;border-radius:8px;padding:7px 14px;font:700 13px system-ui,sans-serif;cursor:pointer}
  #simuopti-ui .b:hover{filter:brightness(1.08)}
  #simuopti-ui .b:disabled{opacity:.55;cursor:wait}
  #simuopti-ui .b.alt{background:var(--carte2);color:var(--texte);border:1px solid var(--ligne2)}
  #simuopti-ui .b.mini{padding:3px 9px;font-size:12px;border-radius:6px}
  /* ---- Cartes ---- */
  #simuopti-ui .card{border:1px solid var(--ligne);border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--carte)}
  #simuopti-ui h4{margin:0 0 6px;color:var(--or);font-size:14px;font-weight:800}
  #simuopti-ui .card>h4:first-child{display:flex;align-items:center;gap:6px}
  #simuopti-ui .sous{margin:-2px 0 8px;color:var(--mut);font-size:12px}
  #simuopti-ui table{border-collapse:collapse;width:100%;font-size:12.5px}
  #simuopti-ui td,#simuopti-ui th{padding:4px 6px;border-bottom:1px solid var(--ligne);text-align:left;vertical-align:top}
  #simuopti-ui th{color:var(--mut);font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:.3px}
  #simuopti-ui .ok{color:var(--ok)}#simuopti-ui .warn{color:var(--warn)}#simuopti-ui .mut{color:var(--mut)}
  #simuopti-ui .big{font-weight:800;color:#fff}
  #simuopti-ui .warn.big{color:var(--warn)}#simuopti-ui .ok.big{color:var(--ok)}
  /* ---- Messages (encadrés) et aide repliable ---- */
  #simuopti-ui .tampon{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0;padding:8px 10px;border-radius:8px;border:1px solid var(--bronze2);border-left:4px solid var(--bronze);background:var(--carte2);font-size:13px}
  #simuopti-ui .tampon b{color:var(--or)}
  #simuopti-ui .tampon input{width:64px!important;text-align:right;font-weight:700}
  #simuopti-ui tr.tampon-l td{color:var(--or);font-weight:700}
  #simuopti-ui .note{margin:6px 0;padding:7px 10px;border-radius:8px;border-left:3px solid var(--ligne2);background:var(--carte2);font-size:13px}
  #simuopti-ui .note.ok{border-left-color:var(--ok);background:var(--okf);color:var(--texte)}
  #simuopti-ui .note.warn{border-left-color:var(--warn);background:var(--warnf);color:var(--texte)}
  #simuopti-ui .note.ko{border-left-color:var(--ko);background:var(--kof);color:var(--texte)}
  #simuopti-ui .note.ok b,#simuopti-ui .note.ok strong{color:var(--ok)}#simuopti-ui .note.warn b{color:var(--warn)}
  #simuopti-ui details.aide{margin:8px 0 0;border-top:1px dashed var(--ligne);padding-top:6px}
  #simuopti-ui details.aide>summary{cursor:pointer;color:var(--mut);font-size:12px;list-style:none}
  #simuopti-ui details.aide>summary::-webkit-details-marker{display:none}
  #simuopti-ui details.aide>summary::before{content:"ℹ️ "}
  #simuopti-ui details.aide[open]>summary{color:var(--texte)}
  #simuopti-ui details.aide>div,#simuopti-ui details.aide>p{color:var(--mut);font-size:12px;margin:6px 0 0}
  #simuopti-ui details.det>summary{cursor:pointer;color:var(--or);font-weight:700;font-size:13px;margin:8px 0 4px}
  /* ---- Résultat principal ---- */
  #simuopti-ui .hero{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin:8px 0 4px}
  #simuopti-ui .va-res{font-size:28px;line-height:1.1;font-weight:900;color:var(--ok);margin:4px 0;letter-spacing:.3px}
  #simuopti-ui .hero .va-res{margin:0}
  #simuopti-ui .badge{display:inline-block;font-size:11px;font-weight:800;padding:2px 9px;border-radius:10px;text-transform:uppercase;letter-spacing:.4px;background:var(--carte2);color:var(--mut);border:1px solid var(--ligne2)}
  #simuopti-ui .badge.ok{background:var(--okf);color:var(--ok);border-color:#2f5a2c}
  #simuopti-ui .badge.warn{background:var(--warnf);color:var(--warn);border-color:#6b4e22}
  #simuopti-ui .badge.ko{background:var(--kof);color:var(--ko);border-color:#6b2e22}
  #simuopti-ui .pourquoi{color:var(--texte);font-size:13px;margin:2px 0 6px}
  /* ---- Sous-onglets (segments) ---- */
  #simuopti-ui .seg{display:flex;gap:4px;padding:4px;background:var(--carte);border:1px solid var(--ligne);border-radius:10px;margin:2px 0 10px}
  #simuopti-ui .seg button{flex:1;background:transparent;color:var(--mut);border:0;border-radius:7px;padding:7px 6px;font:700 12.5px system-ui,sans-serif;cursor:pointer}
  #simuopti-ui .seg button.on{background:var(--bronze);color:#1a120a}
  #simuopti-ui .seg button:not(.on):hover{color:var(--texte);background:var(--carte2)}
  /* ---- Analyse RC ---- */
  #simuopti-ui .reglages{border:1px solid var(--ligne);border-radius:10px;background:var(--carte);margin-bottom:10px}
  #simuopti-ui .reglages>summary{list-style:none;display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;font-weight:800;color:var(--or)}
  #simuopti-ui .reglages>summary::-webkit-details-marker{display:none}
  #simuopti-ui .reglages>summary{white-space:nowrap}
  #simuopti-ui .reglages>summary .res{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:600;color:var(--mut);font-size:12px;text-align:right}
  #simuopti-ui label.case{display:block;line-height:1.5}
  #simuopti-ui .reglages>summary .chev,#simuopti-ui .armybox .chev{transition:transform .15s;color:var(--mut)}
  #simuopti-ui .reglages[open]>summary .chev,#simuopti-ui .armybox[open] .chev{transform:rotate(180deg)}
  #simuopti-ui .reglages .in{padding:0 12px 10px}
  #simuopti-ui .xpsel{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:12px}
  #simuopti-ui .xpsel>span{margin-right:4px;color:var(--mut)}
  #simuopti-ui .chip{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border:1px solid var(--ligne2);border-radius:12px;background:var(--champ);color:var(--texte);cursor:pointer;user-select:none}
  #simuopti-ui .chip:has(input:checked){background:var(--bronze);color:#1a120a;border-color:var(--bronze);font-weight:800}
  #simuopti-ui .chip input{margin:0;accent-color:#1a120a}
  #simuopti-ui .armybox{margin-top:8px;border:1px solid var(--ligne);border-radius:10px;background:var(--carte)}
  #simuopti-ui .armybox summary{list-style:none;display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;color:var(--or);font-weight:800}
  #simuopti-ui .armybox summary::-webkit-details-marker{display:none}
  #simuopti-ui .armybox summary:hover,#simuopti-ui .reglages>summary:hover{background:var(--carte2);border-radius:10px}
  #simuopti-ui .armybox .ico{font-size:16px}
  #simuopti-ui .armybox .badge{margin-left:auto;text-transform:none;letter-spacing:0;background:var(--warnf);color:var(--warn);border-color:#6b4e22}
  #simuopti-ui .armybox .badge.on{background:var(--okf);color:var(--ok);border-color:#2f5a2c}
  #simuopti-ui .armybox textarea,#simuopti-ui .armybox [data-armyread]{margin:0 12px 10px;width:calc(100% - 24px)}
  #simuopti-ui .alertes{margin-top:8px;padding:7px 10px;border-left:3px solid var(--warn);background:var(--warnf);border-radius:8px;font-size:12.5px}
  #simuopti-ui .alertes div{margin:3px 0}
  #simuopti-ui pre.copie{white-space:pre-wrap;background:var(--champ);border:1px solid var(--ligne);border-radius:8px;padding:7px 9px;font:12px ui-monospace,Consolas,monospace;margin:6px 0;color:var(--or)}
  #simuopti-ui .niv{display:inline-block;min-width:26px;text-align:center;padding:1px 6px;border-radius:6px;font-weight:800}
  #simuopti-ui .niv.ok{background:var(--okf)}#simuopti-ui .niv.warn{background:var(--warnf)}
  /* ---- Fiches joueurs ---- */
  #simuopti-ui .fi-tab tr{cursor:pointer}
  #simuopti-ui .fi-tab tr:hover td{background:var(--carte2)}
  #simuopti-ui .fi-tab tr.on td{background:var(--okf)}
  #simuopti-ui .fi-tab td{vertical-align:middle}
  #simuopti-ui .fi-tab .nomf{font-weight:800;color:var(--or);cursor:pointer}
  #simuopti-ui .fi-edit input,#simuopti-ui .fi-edit select{width:100%!important;box-sizing:border-box}
  #simuopti-ui [data-simfiche]{font:13px system-ui,sans-serif;color:#3d2e14;margin:0 0 6px}
  #simuopti-ui [data-simfiche]:not(:empty){background:#e8d9a8;border:1px solid #b39a5c;border-radius:6px;padding:4px 8px}
  /* ---- VA & TdP ---- */
  #simuopti-ui .grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 12px}
  #simuopti-ui .grid2 label{flex-direction:column;align-items:stretch;gap:3px}
  #simuopti-ui .grid2 input,#simuopti-ui .grid2 select{width:100%!important;box-sizing:border-box}
  #simuopti-ui .depart-card{border-color:var(--bronze2)}
  #simuopti-ui .depart-card .va-res{font-size:22px}
  #simuopti-ui .barre-va{display:inline-block;height:9px;background:var(--bronze);border-radius:3px;vertical-align:middle}
  #simuopti-ui tr.choisie td{color:#fff;font-weight:800}
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
    const onglets = [['rc', '📜', 'Analyse RC', 'RC'], ['va', '🐜', 'VA &amp; TdP', 'VA·TdP'], ['fiches', '📇', 'Joueurs', 'Joueurs']];
    let sectionSim = '';
    const st = document.createElement('style'); st.textContent = css; racine.appendChild(st);
    const btn = el('<button id="simuopti-ui-btn" type="button">⚔️ SimuOpti</button>');
    panel = el(`<div id="simuopti-ui">
      <header><span class="titre">⚔️ SimuOpti <small>v${VERSION}</small></span><span class="ctl">
        <button type="button" data-reset title="Remettre en place (position et taille d'origine)">⟲</button>
        <button type="button" data-max title="Agrandir en plein écran">⤢</button>
        <button type="button" data-x title="Fermer">×</button></span></header>
      <nav>${onglets.map(([k, i, l, c]) => `<button type="button" data-tab="${k}"><span class="ico">${i}</span><span class="long">${l}</span><span class="court">${c}</span></button>`).join('')}</nav>
      <div class="fbar" title="Joueur actif : sa fiche remplit les autres onglets"><span class="lib">📇 Joueur actif</span><input type="text" data-fiche list="simuopti-fiches" placeholder="Choisir un joueur…" autocomplete="off"><datalist id="simuopti-fiches"></datalist><span class="mut" data-fres></span></div>
      <div class="body">
        <section class="vue" data-vue="rc">${vueRc()}</section>
        ${sectionSim}
        <section class="vue" data-vue="va">${vueVa()}</section>
        <section class="vue" data-vue="fiches">${vueFiches()}</section>
      </div></div>`);
    if (cfg.bouton) racine.append(btn);
    racine.append(panel);
    btn.onclick = basculer;
    panel.querySelector('[data-x]').onclick = fermer;
    panel.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => onglet(b.dataset.tab)));
    if (APP) panel.classList.add('app', 'open'); else fenetre();
    initRc();
    initVa(); initFiches();
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
          <label title="JSN ajoutées au minimum pour encaisser la réplique si l’adversaire a pondu depuis le RC">🛡️ Marge tampon JSN (%) <input type="number" min="0" max="500" step="1" data-k="tampon"></label>
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
      v.querySelector('[data-regres]').textContent = `${cfg.pseudo || 'pseudo ?'} · Armes ${cfg.armes || 0} · Bouclier ${cfg.bouclier || 0} · Cochenille ${cfg.cochenille || 0} · Tampon +${cfg.tampon ?? Core.TAMPON_DEFAUT} % · ${(cfg.xpUnits || []).map(L).join(' + ') || 'aucune unité'}`;
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
    out.addEventListener('change', (e) => {
      if (!e.target.matches('[data-tampon]')) return;
      cfg.tampon = Math.max(0, parseFloat(e.target.value) || 0); saveCfg(cfg);
      v.querySelector('[data-k=tampon]').value = cfg.tampon;
      majReglages(); rerender();
    });
    out.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.copy != null) copier(ui.copieTexte || '', b);
      if (b.dataset.copiearmee != null) copier(b.dataset.copiearmee, b);
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
          <tr class="tampon-l"><td>🛡️ JSN tampon : minimum → avec la marge (bouclier ${res.my.bouclier}, ${res.my.source.bouclier})</td><td class="big">${fmt(o0.jsnNeed)} → ${fmt(o0.jsnMarge)}</td></tr>
          </table>
          <div class="tampon">🛡️ <b>Marge tampon</b> <input type="number" min="0" max="500" step="5" data-tampon value="${cfg.tampon ?? Core.TAMPON_DEFAUT}"> % <span>= <b>+${fmt(o0.jsnMarge - o0.jsnNeed)} JSN</b> au-delà du minimum, si l’adversaire a pondu depuis ce RC</span></div>
          <div class="mut" style="margin-top:6px">Armée conseillée (${cibles.map(L).join(' + ')}) :</div>` + bloc(o0, false);
        let choisi = o0;
        const mine = Core.parseArmyLoose(cfg.armee);
        if (mine.length) {
          const o = Core.optimize({ enemy: r.combat.defenders, eArmes: r.defArmes, eMult, my: res.my, avail: mine, cibles });
          html += `<h4 style="margin-top:8px">Envoi optimal depuis ton armée</h4>` + bloc(o, true);
          if (o.passe) choisi = o;
        }
        if (!exactV) html += '<div class="warn">Vie estimée par plafond : la vraie vie est plus basse, l’armée conseillée est prudente.</div>';
        html += `<details class="aide"><summary>Pourquoi une marge tampon de JSN ?</summary><div>Les JSN partent en tête de ton armée : la réplique du défenseur tue les unités dans l’ordre de l’armée, donc ce sont elles qui meurent à la place des unités qui frappent et qui évoluent. Le minimum est calculé sur l’armée vue dans ce RC. Mais entre ce RC et l’arrivée de ton attaque, l’adversaire continue de pondre : sa réplique grandit, et sans marge ce sont tes autres unités qui meurent et n’évoluent pas. La marge ajoute ce pourcentage de JSN au minimum : <b>${cfg.tampon ?? Core.TAMPON_DEFAUT} %</b> ici (20 % par défaut). Augmente-la si le RC est ancien ou si l’adversaire pond vite (voir sa TdP dans l’onglet VA &amp; TdP), baisse-la si le RC vient d’être pris. Elle ne touche pas la vie à battre : si sa ponte est forte, refais un RC récent avant d’attaquer.</div></details>`;
        html += '<div class="row">';
        html += `${choisi.passe ? `<button class="b mini alt" type="button" data-copiearmee="${esc(texteArmee(choisi.rows.map((x) => [x.c, x.envoi])))}">📋 Copier l’armée conseillée</button>` : ''}</div>`;
      }
      html += '</div>';
    });
    out.innerHTML = html;
  }

  const nombreAff = (n) => Math.max(0, Math.floor(n || 0)).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
  /** « 456 Jeunes Soldates Naines, 1 450 Artilleuses » : relisible par SimuOpti (collage d'une armée). */
  const texteArmee = (rows) => rows.filter(([, n]) => n > 0).map(([c, n]) => `${nombreAff(n)} ${Core.NOMS[c][n > 1 ? 1 : 0]}`).join(', ');
  const memeNom = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();


  /* ============================ Onglet VA & TdP ============================ */
  function vueVa() {
    return `
      <div class="seg" data-seg>
        ${LITE ? '' : '<button type="button" data-vs="oly">🔎 <span class="long">VA d’après ses attaques</span><span class="court">VA auto</span></button>'}
        <button type="button" data-vs="mesure">📏 <span class="long">Mesure &amp; trajet</span><span class="court">Mesure</span></button>
        <button type="button" data-vs="tdp">🥚 <span class="long">TdP &amp; départ</span><span class="court">TdP</span></button>
      </div>
      ${LITE ? '' : carteVaOly()}
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
    // sous-onglets : VA d'après ses attaques, mesure et trajet, TdP et départ
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
      departOut.innerHTML = h;
    };
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
    let quoi = 'l’onglet VA &amp; TdP';
    return `
      <div class="card"><h4>📇 Fiches joueurs</h4>
        <div class="sous">Remplies toutes seules par les autres onglets. Touche un joueur pour le choisir : sa fiche remplit ${quoi}.</div>
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
    let boutonSim = '';
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
          ${boutonSim}<button class="b" type="button" data-fiva="va">🕐 VA &amp; TdP</button>
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
