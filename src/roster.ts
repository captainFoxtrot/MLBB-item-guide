export type Side = 'ally' | 'enemy';
export type Screen = 'draft' | 'loading' | 'scoreboard' | 'unknown';
export interface HeroSlot { side: Side; position: number; hero: string | null; locked: boolean; source: 'ai'|'manual'|null; }
export interface Roster { slots: HeroSlot[]; you: number | null; youLocked: boolean; screen: Screen; updatedAt: string | null; }
export const HEROES = [
'Aamon','Akai','Aldous','Alice','Alpha','Alucard','Angela','Argus','Arlott','Atlas','Aulus','Aurora',
'Badang','Balmond','Bane','Barats','Baxia','Beatrix','Belerick','Benedetta','Brody','Bruno',
'Carmilla','Cecilion','Chang’e','Chip','Chou','Cici','Claude','Clint','Cyclops',
'Diggie','Dyrroth','Edith','Esmeralda','Estes','Eudora','Fanny','Faramis','Floryn','Franco','Fredrinn','Freya',
'Gatotkaca','Gloo','Gord','Granger','Grock','Guinevere','Gusion','Hanabi','Hanzo','Harith','Harley','Hayabusa','Helcurt','Hilda','Hylos',
'Irithel','Ixia','Jawhead','Johnson','Joy','Julian','Kadita','Kagura','Kaja','Karina','Karrie','Khaleed','Khufra','Kimmy',
'Lancelot','Lapu-Lapu','Layla','Leomord','Lesley','Ling','Lolita','Lukas','Lunox','Luo Yi',
'Martis','Masha','Mathilda','Melissa','Minotaur','Minsitthar','Miya','Moskov','Nana','Natalia','Natan','Nolan','Novaria',
'Odette','Paquito','Pharsa','Phoveus','Popol and Kupa','Rafaela','Roger','Ruby','Saber','Selena','Silvanna','Sun','Suyou',
'Terizla','Thamuz','Tigreal','Uranus','Vale','Valentina','Valir','Vexana','Wanwan','X.Borg','Xavier','Yi Sun-shin',
'Yin','Yve','Yu Zhong','Zhask','Zilong','Zetian','Obsidia','Kalea'
].sort((a,b)=>a.localeCompare(b));
export function normalizeHero(value: unknown): string | null {
 if(typeof value!=='string') return null;
 const s=value.trim().toLocaleLowerCase().replace(/[’'\s.\-_]/g,'');
 return HEROES.find(h=>h.toLocaleLowerCase().replace(/[’'\s.\-_]/g,'')===s)||null;
}
export function blankRoster(): Roster {return {slots:Array.from({length:10},(_,i):HeroSlot=>({side:i<5?'ally':'enemy',position:i%5,hero:null,locked:false,source:null})),you:null,youLocked:false,screen:'unknown',updatedAt:null};}
