// Shop and inventory overlays. These are self-contained modal controllers the
// town scene pushes onto itself: they own input while open and render over the
// town. Each exposes update()/draw() and calls onClose() when dismissed.

import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth, wrapText } from '../gfx/font.js';
import { panel, panelTitle, bar, heading, UI } from '../gfx/ui.js';
import { rect, rectOutline } from '../gfx/pixel.js';
import { drawIcon } from '../gfx/props.js';
import { drawPet } from '../gfx/actors.js';
import {
  WEAPONS, POTIONS, PETS, RARITY, ABILITIES, CATEGORIES, LEVELS,
  weaponsFor,
} from '../game/data.js';

// ---------------------------------------------------------------- Weapon shop

export class WeaponShop {
  constructor(hero, onClose) {
    this.hero = hero; this.onClose = onClose;
    this.items = weaponsFor(hero.s.class);
    this.sel = 0; this.t = 0; this.flash = null; this.flashT = 0;
  }
  update(dt) {
    this.t += dt;
    if (this.flashT > 0) this.flashT -= dt;
    if (Input.repeated('up')) { this.sel = (this.sel + this.items.length - 1) % this.items.length; Audio.select(); }
    if (Input.repeated('down')) { this.sel = (this.sel + 1) % this.items.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'interact', 'light')) this._buyOrEquip();
    if (Input.pressed('menu') || Input.pressed('back')) { Audio.deny(); this.onClose(); }
  }
  _buyOrEquip() {
    const it = this.items[this.sel];
    const owned = this.hero.ownsWeapon(it.id);
    if (owned) {
      this.hero.equip(it.id); this.hero.save();
      Audio.confirm(); this._msg('Equipped ' + it.name, UI.good);
    } else if (this.hero.s.gold >= it.price) {
      this.hero.spendGold(it.price); this.hero.addItem(it.id); this.hero.equip(it.id); this.hero.save();
      Audio.coin(); this._msg('Bought & equipped!', UI.gold);
    } else { Audio.deny(); this._msg('Not enough gold', UI.bad); }
  }
  _msg(text, color) { this.flash = { text, color }; this.flashT = 1.4; }

  draw(g, W, H) {
    dim(g, W, H);
    const bw = 300, bh = 180, bx = W / 2 - bw / 2, by = H / 2 - bh / 2;
    panel(g, bx, by, bw, bh);
    panelTitle(g, bx, by, bw, 'WEAPON SHOP');
    drawText(g, `Gold: ${this.hero.s.gold}`, bx + bw - 8, by + 6, { color: UI.gold, align: 'right' });

    // list on the left
    const listX = bx + 8, listY = by + 18, rowH = 15, listW = 150;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const ry = listY + i * rowH;
      const on = i === this.sel;
      const owned = this.hero.ownsWeapon(it.id);
      const equipped = this.hero.s.equipped.weapon === it.id || this.hero.s.equipped.trinket === it.id;
      if (on) { rect(g, listX, ry, listW, rowH - 1, UI.frameDark); rectOutline(g, listX, ry, listW, rowH - 1, RARITY[it.rarity].color); }
      drawIcon(g, it.icon, listX + 3, ry + 3);
      drawText(g, it.name, listX + 15, ry + 4, { color: on ? UI.ink : RARITY[it.rarity].color });
      if (equipped) drawText(g, 'E', listX + listW - 8, ry + 4, { color: UI.good });
      else if (owned) drawText(g, '✓'.replace('✓', 'v'), listX + listW - 8, ry + 4, { color: UI.inkDim });
      else drawText(g, `${it.price}`, listX + listW - 6, ry + 4, { color: UI.gold, align: 'right' });
    }

    // detail panel on the right
    const dx = bx + 168, dw = bw - 176;
    const it = this.items[this.sel];
    rect(g, dx, by + 18, dw, bh - 40, UI.bg);
    rectOutline(g, dx, by + 18, dw, bh - 40, UI.frameDark);
    drawText(g, it.name, dx + dw / 2, by + 24, { color: RARITY[it.rarity].color, align: 'center' });
    drawText(g, RARITY[it.rarity].name, dx + dw / 2, by + 34, { color: RARITY[it.rarity].color, align: 'center', scale: 1 });
    // big icon
    drawIcon(g, it.icon, dx + dw / 2 - 8, by + 44, 3);
    let sy = by + 78;
    const stat = (label, val) => { if (val) { drawText(g, label, dx + 6, sy, { color: UI.inkDim }); drawText(g, (val > 0 ? '+' : '') + val, dx + dw - 6, sy, { color: val > 0 ? UI.good : UI.bad, align: 'right' }); sy += 10; } };
    stat('Attack', it.attack); stat('Magic', it.magic); stat('Defense', it.defense);
    stat('HP', it.hp); stat('Mana', it.mana); stat('Speed', it.speed);
    if (it.crit) { drawText(g, 'Crit', dx + 6, sy, { color: UI.inkDim }); drawText(g, `+${Math.round(it.crit * 100)}%`, dx + dw - 6, sy, { color: UI.good, align: 'right' }); sy += 10; }
    const dlines = wrapText(it.desc, dw - 10);
    dlines.forEach((l) => { drawText(g, l, dx + 6, sy, { color: UI.inkDim }); sy += 9; });

    if (this.flashT > 0) { g.globalAlpha = Math.min(1, this.flashT * 2); drawText(g, this.flash.text, W / 2, by + bh - 22, { color: this.flash.color, align: 'center' }); g.globalAlpha = 1; }
    drawText(g, 'J buy/equip   Esc leave', W / 2, by + bh - 11, { color: UI.inkDim, align: 'center' });
  }
}

// ---------------------------------------------------------------- Potion shop

export class PotionShop {
  constructor(hero, onClose) {
    this.hero = hero; this.onClose = onClose;
    this.keys = Object.keys(POTIONS);
    this.sel = 0; this.t = 0; this.flash = null; this.flashT = 0;
  }
  update(dt) {
    this.t += dt; if (this.flashT > 0) this.flashT -= dt;
    if (Input.repeated('up')) { this.sel = (this.sel + this.keys.length - 1) % this.keys.length; Audio.select(); }
    if (Input.repeated('down')) { this.sel = (this.sel + 1) % this.keys.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'interact', 'light')) this._buy();
    if (Input.pressed('menu') || Input.pressed('back')) { Audio.deny(); this.onClose(); }
  }
  _buy() {
    const key = this.keys[this.sel]; const pot = POTIONS[key];
    if (this.hero.s.gold >= pot.price) {
      this.hero.spendGold(pot.price); this.hero.addPotion(key, 1); this.hero.save();
      Audio.coin(); this.flash = { text: 'Bought ' + pot.name, color: UI.gold }; this.flashT = 1.2;
    } else { Audio.deny(); this.flash = { text: 'Not enough gold', color: UI.bad }; this.flashT = 1.2; }
  }
  draw(g, W, H) {
    dim(g, W, H);
    const bw = 240, bh = 150, bx = W / 2 - bw / 2, by = H / 2 - bh / 2;
    panel(g, bx, by, bw, bh);
    panelTitle(g, bx, by, bw, 'POTION SHOP');
    drawText(g, `Gold: ${this.hero.s.gold}`, bx + bw - 8, by + 6, { color: UI.gold, align: 'right' });

    const rowH = 24;
    this.keys.forEach((key, i) => {
      const pot = POTIONS[key];
      const ry = by + 18 + i * rowH;
      const on = i === this.sel;
      if (on) { rect(g, bx + 6, ry, bw - 12, rowH - 2, UI.frameDark); rectOutline(g, bx + 6, ry, bw - 12, rowH - 2, pot.color); }
      drawIcon(g, pot.icon, bx + 12, ry + 4, 1.5);
      drawText(g, pot.name, bx + 26, ry + 3, { color: on ? UI.ink : UI.inkDim });
      drawText(g, pot.desc, bx + 26, ry + 13, { color: UI.inkDim });
      drawText(g, `x${this.hero.s.inventory.potions[key] || 0}`, bx + bw - 40, ry + 8, { color: UI.ink, align: 'right' });
      drawText(g, `${pot.price}g`, bx + bw - 10, ry + 8, { color: UI.gold, align: 'right' });
    });

    if (this.flashT > 0) { g.globalAlpha = Math.min(1, this.flashT * 2); drawText(g, this.flash.text, W / 2, by + bh - 20, { color: this.flash.color, align: 'center' }); g.globalAlpha = 1; }
    drawText(g, 'J buy   Esc leave', W / 2, by + bh - 10, { color: UI.inkDim, align: 'center' });
  }
}

// ---------------------------------------------------------------- Inventory

export class InventoryMenu {
  constructor(hero, onClose, initialTab = 0) {
    this.hero = hero; this.onClose = onClose;
    this.tab = initialTab; // 0 gear, 1 abilities, 2 pets, 3 stats
    this.tabs = ['GEAR', 'ABILITIES', 'PETS', 'HERO'];
    this.sel = 0; this.t = 0;
    this.assigning = null; // ability id awaiting a slot key
  }
  update(dt) {
    this.t += dt;
    if (Input.pressed('tab')) { this.tab = (this.tab + 1) % this.tabs.length; this.sel = 0; Audio.select(); }
    if (Input.repeated('left') && !this.assigning) { this.tab = (this.tab + this.tabs.length - 1) % this.tabs.length; this.sel = 0; Audio.select(); }
    if (Input.repeated('right') && !this.assigning) { this.tab = (this.tab + 1) % this.tabs.length; this.sel = 0; Audio.select(); }

    if (this.tab === 0) this._updateGear();
    else if (this.tab === 1) this._updateAbilities();
    else if (this.tab === 2) this._updatePets();

    if (Input.pressed('menu') || Input.pressed('back') || Input.pressed('inventory')) { Audio.deny(); this.hero.save(); this.onClose(); }
  }
  _gearList() {
    return [
      ...this.hero.s.inventory.weapons.map((id) => ({ id, ...WEAPONS[id] })),
      ...this.hero.s.inventory.trinkets.map((id) => ({ id, ...WEAPONS[id] })),
    ];
  }
  _updateGear() {
    const list = this._gearList();
    if (!list.length) return;
    if (Input.repeated('up')) { this.sel = (this.sel + list.length - 1) % list.length; Audio.select(); }
    if (Input.repeated('down')) { this.sel = (this.sel + 1) % list.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'interact', 'light')) { this.hero.equip(list[this.sel].id); this.hero.save(); Audio.confirm(); }
  }
  _updateAbilities() {
    const list = this.hero.unlockedAbilityDefs();
    if (!list.length) return;
    if (this.assigning) {
      for (let s = 0; s < 4; s++) {
        if (Input.pressed('slot' + (s + 1))) {
          this.hero.setAbilitySlot(s, this.assigning); this.hero.save();
          this.assigning = null; Audio.confirm(); return;
        }
      }
      if (Input.pressed('back') || Input.pressed('menu')) { this.assigning = null; Audio.deny(); }
      return;
    }
    if (Input.repeated('up')) { this.sel = (this.sel + list.length - 1) % list.length; Audio.select(); }
    if (Input.repeated('down')) { this.sel = (this.sel + 1) % list.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'interact', 'light')) { this.assigning = list[this.sel].id; Audio.select(); }
  }
  _updatePets() {
    const list = this.hero.s.inventory.pets;
    if (!list.length) return;
    if (Input.repeated('up')) { this.sel = (this.sel + list.length - 1) % list.length; Audio.select(); }
    if (Input.repeated('down')) { this.sel = (this.sel + 1) % list.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'interact', 'light')) {
      const id = list[this.sel];
      this.hero.equipPet(this.hero.s.equipped.pet === id ? null : id); this.hero.save(); Audio.confirm();
    }
  }

  draw(g, W, H) {
    dim(g, W, H);
    const bw = 320, bh = 200, bx = W / 2 - bw / 2, by = H / 2 - bh / 2;
    panel(g, bx, by, bw, bh);

    // tab bar
    const tw = bw / this.tabs.length;
    this.tabs.forEach((name, i) => {
      const tx = bx + i * tw;
      const on = i === this.tab;
      if (on) { rect(g, tx, by, tw, 12, UI.frameDark); rect(g, tx, by, tw, 1, UI.frameLite); }
      drawText(g, name, tx + tw / 2, by + 3, { color: on ? UI.gold : UI.inkDim, align: 'center' });
    });
    rect(g, bx + 1, by + 12, bw - 2, 1, UI.frame);

    const cy = by + 18;
    if (this.tab === 0) this._drawGear(g, bx, cy, bw, bh);
    else if (this.tab === 1) this._drawAbilities(g, bx, cy, bw, bh);
    else if (this.tab === 2) this._drawPets(g, bx, cy, bw, bh);
    else this._drawStats(g, bx, cy, bw, bh);

    drawText(g, 'Tab/←→ switch   J select   I/Esc close', W / 2, by + bh - 10, { color: UI.inkDim, align: 'center' });
  }

  _drawGear(g, bx, cy, bw, bh) {
    const list = this._gearList();
    const rowH = 14;
    list.forEach((it, i) => {
      const ry = cy + i * rowH;
      const on = i === this.sel;
      const eq = this.hero.s.equipped.weapon === it.id || this.hero.s.equipped.trinket === it.id;
      if (on) { rect(g, bx + 6, ry, 180, rowH - 1, UI.frameDark); rectOutline(g, bx + 6, ry, 180, rowH - 1, RARITY[it.rarity].color); }
      drawIcon(g, it.icon, bx + 9, ry + 3);
      drawText(g, it.name, bx + 21, ry + 4, { color: RARITY[it.rarity].color });
      if (eq) drawText(g, 'EQUIPPED', bx + 182, ry + 4, { color: UI.good, align: 'right' });
    });
    // hero stat preview
    const px = bx + 200, pw = bw - 208;
    rect(g, px, cy, pw, bh - 34, UI.bg); rectOutline(g, px, cy, pw, bh - 34, UI.frameDark);
    const h = this.hero;
    let y = cy + 6;
    const s = (l, v) => { drawText(g, l, px + 6, y, { color: UI.inkDim }); drawText(g, `${v}`, px + pw - 6, y, { color: UI.ink, align: 'right' }); y += 12; };
    drawText(g, h.cls().name + ' Lv ' + h.s.level, px + pw / 2, y, { color: UI.gold, align: 'center' }); y += 14;
    s('HP', h.maxHp); s('Mana', h.maxMana); s('Attack', h.attack);
    s('Defense', h.defense); s('Magic', h.magic); s('Speed', h.speed);
    s('Crit', Math.round(h.crit * 100) + '%');
  }

  _drawAbilities(g, bx, cy, bw, bh) {
    const list = this.hero.unlockedAbilityDefs();
    const slots = this.hero.s.equippedAbilities;
    // equipped slot row
    drawText(g, 'Equipped slots:', bx + 8, cy, { color: UI.inkDim });
    for (let i = 0; i < 4; i++) {
      const sx = bx + 90 + i * 24;
      panel(g, sx, cy - 3, 20, 18, { bg: UI.bg });
      drawText(g, `${i + 1}`, sx + 2, cy - 2, { color: UI.inkDim });
      if (slots[i]) drawIcon(g, ABILITIES[slots[i]].icon, sx + 6, cy + 3);
    }

    const listY = cy + 22, rowH = 14;
    list.forEach((ab, i) => {
      const ry = listY + i * rowH;
      const on = i === this.sel;
      const slot = slots.indexOf(ab.id);
      if (on) { rect(g, bx + 6, ry, 150, rowH - 1, UI.frameDark); rectOutline(g, bx + 6, ry, 150, rowH - 1, '#a56bd9'); }
      drawIcon(g, ab.icon, bx + 9, ry + 3);
      drawText(g, ab.name, bx + 21, ry + 4, { color: on ? UI.ink : UI.inkDim });
      if (slot >= 0) drawText(g, `[${slot + 1}]`, bx + 152, ry + 4, { color: UI.gold, align: 'right' });
    });

    // detail
    const dx = bx + 168, dw = bw - 176;
    rect(g, dx, listY, dw, bh - listY + cy - 34, UI.bg); rectOutline(g, dx, listY, dw, bh - listY + cy - 34, UI.frameDark);
    const ab = list[this.sel];
    if (ab) {
      drawText(g, ab.name, dx + dw / 2, listY + 4, { color: '#c9a0f2', align: 'center' });
      drawText(g, ab.branch + ' branch', dx + dw / 2, listY + 14, { color: UI.inkDim, align: 'center' });
      let y = listY + 26;
      if (ab.mana) { drawText(g, 'Mana', dx + 6, y, { color: UI.inkDim }); drawText(g, `${ab.mana}`, dx + dw - 6, y, { color: UI.mana, align: 'right' }); y += 10; }
      if (ab.cd) { drawText(g, 'Cooldown', dx + 6, y, { color: UI.inkDim }); drawText(g, `${ab.cd}s`, dx + dw - 6, y, { color: UI.ink, align: 'right' }); y += 10; }
      if (ab.dmg) { drawText(g, 'Damage', dx + 6, y, { color: UI.inkDim }); drawText(g, `${ab.dmg}`, dx + dw - 6, y, { color: UI.bad, align: 'right' }); y += 10; }
      wrapText(ab.desc, dw - 10).forEach((l) => { drawText(g, l, dx + 6, y, { color: UI.inkDim }); y += 9; });
    }

    if (this.assigning) {
      g.fillStyle = 'rgba(8,6,16,0.6)'; g.fillRect(bx, cy, bw, bh - 34);
      drawText(g, `Assign "${ABILITIES[this.assigning].name}"`, bx + bw / 2, cy + bh / 2 - 20, { color: UI.gold, align: 'center' });
      drawText(g, 'Press 1, 2, 3 or 4 to choose a slot', bx + bw / 2, cy + bh / 2, { color: UI.ink, align: 'center' });
      drawText(g, 'Esc to cancel', bx + bw / 2, cy + bh / 2 + 12, { color: UI.inkDim, align: 'center' });
    } else {
      drawText(g, 'J = assign to a slot', bx + 8, cy + bh - 46, { color: UI.inkDim });
    }
  }

  _drawPets(g, bx, cy, bw, bh) {
    const list = this.hero.s.inventory.pets;
    if (!list.length) {
      drawText(g, 'No pets yet.', bx + bw / 2, cy + 30, { color: UI.inkDim, align: 'center' });
      drawText(g, 'Defeat bosses for a chance at a pet egg!', bx + bw / 2, cy + 44, { color: UI.inkDim, align: 'center' });
      return;
    }
    const rowH = 20;
    list.forEach((id, i) => {
      const pet = PETS[id];
      const ry = cy + i * rowH;
      const on = i === this.sel;
      const eq = this.hero.s.equipped.pet === id;
      if (on) { rect(g, bx + 6, ry, 180, rowH - 2, UI.frameDark); rectOutline(g, bx + 6, ry, 180, rowH - 2, '#e0679a'); }
      drawPet(g, pet, bx + 18, ry + 10, this.t);
      drawText(g, pet.name, bx + 32, ry + 3, { color: on ? UI.ink : UI.inkDim });
      drawText(g, pet.desc, bx + 32, ry + 12, { color: UI.inkDim });
      if (eq) drawText(g, 'ACTIVE', bx + 182, ry + 6, { color: UI.good, align: 'right' });
    });
    drawText(g, 'J = summon / dismiss pet', bx + 8, cy + bh - 44, { color: UI.inkDim });
  }

  _drawStats(g, bx, cy, bw, bh) {
    const h = this.hero;
    // left: derived stats; right: academic mastery grid
    let y = cy + 4;
    drawText(g, `${h.cls().name}  Level ${h.s.level}`, bx + 8, y, { color: UI.gold }); y += 12;
    bar(g, bx + 8, y, h.s.xp, h.xpToNext, { w: 150, h: 5, color: UI.xp, label: 'XP' }); y += 14;
    const s = (l, v) => { drawText(g, l, bx + 8, y, { color: UI.inkDim }); drawText(g, `${v}`, bx + 158, y, { color: UI.ink, align: 'right' }); y += 11; };
    s('HP', h.maxHp); s('Mana', h.maxMana); s('Attack', h.attack); s('Defense', h.defense);
    s('Magic', h.magic); s('Speed', h.speed); s('Gold', h.s.gold);
    y += 2;
    drawText(g, 'Enemies defeated: ' + h.s.stats.enemiesDefeated, bx + 8, y, { color: UI.inkDim }); y += 10;
    const acc = h.s.stats.questionsAnswered ? Math.round(h.s.stats.correctAnswers / h.s.stats.questionsAnswered * 100) : 0;
    drawText(g, 'Study accuracy: ' + acc + '%', bx + 8, y, { color: UI.inkDim });

    // mastery grid on the right
    const gx = bx + 180, gw = bw - 188;
    drawText(g, 'ACADEMIC MASTERY', gx + gw / 2, cy + 2, { color: UI.gold, align: 'center' });
    let gy = cy + 14;
    for (const c of CATEGORIES) {
      drawText(g, c.name, gx, gy, { color: c.color, scale: 1 });
      const m = Math.round(h.categoryMastery(c.id));
      bar(g, gx, gy + 8, m, 100, { w: gw - 20, h: 4, color: c.color });
      drawText(g, `${m}`, gx + gw, gy + 7, { color: UI.ink, align: 'right' });
      gy += 16;
    }
  }
}

function dim(g, W, H) { g.fillStyle = 'rgba(8,6,16,0.72)'; g.fillRect(0, 0, W, H); }
