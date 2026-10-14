// Hand-painted UI art supplied for the HUD (cut from the reference sheets).
// Small files, inlined as data URIs at build time so the single-file build works offline.
import coinBar from '../assets/ui/coin_bar.webp';
import gemBar from '../assets/ui/gem_bar.webp';
import bagBar from '../assets/ui/bag_bar.webp';
import questBar from '../assets/ui/quest_bar.webp';
import campBtn from '../assets/ui/camp_btn.webp';
import targetCard from '../assets/ui/target_card.webp';
import btnPets from '../assets/ui/btn_pets.webp';
import btnEggs from '../assets/ui/btn_eggs.webp';
import btnUpgrades from '../assets/ui/btn_upgrades.webp';
import btnMuseum from '../assets/ui/btn_museum.webp';
import btnQuests from '../assets/ui/btn_quests.webp';
import btnSettings from '../assets/ui/btn_settings.webp';
import btnSoundOn from '../assets/ui/btn_sound_on.webp';
import btnSoundOff from '../assets/ui/btn_sound_off.webp';
import slotShovel from '../assets/ui/slot_shovel.webp';
import slotShovelOn from '../assets/ui/slot_shovel_on.webp';
import slotPickaxe from '../assets/ui/slot_pickaxe.webp';
import slotPickaxeOn from '../assets/ui/slot_pickaxe_on.webp';
import slotLantern from '../assets/ui/slot_lantern.webp';
import slotLanternOn from '../assets/ui/slot_lantern_on.webp';
import slotScanner from '../assets/ui/slot_scanner.webp';
import slotScannerOn from '../assets/ui/slot_scanner_on.webp';

export const UI_ART = {
  coinBar, gemBar, bagBar, questBar, campBtn, targetCard,
  btnPets, btnEggs, btnUpgrades, btnMuseum, btnQuests, btnSettings, btnSoundOn, btnSoundOff,
  slots: [
    { off: slotShovel, on: slotShovelOn },
    { off: slotPickaxe, on: slotPickaxeOn },
    { off: slotLantern, on: slotLanternOn },
    { off: slotScanner, on: slotScannerOn },
  ],
};
