import { loadFont as anton } from "@remotion/google-fonts/Anton";
import { loadFont as archivoBlack } from "@remotion/google-fonts/ArchivoBlack";
import { loadFont as bangers } from "@remotion/google-fonts/Bangers";
import { loadFont as bebas } from "@remotion/google-fonts/BebasNeue";
import { loadFont as inter } from "@remotion/google-fonts/Inter";
import { loadFont as montserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as oswald } from "@remotion/google-fonts/Oswald";
import { loadFont as poppins } from "@remotion/google-fonts/Poppins";

// Captions use Montserrat; headers can use any of FONTS (header.ts). Only the latin subset is loaded.
export const { fontFamily } = montserrat("normal", { weights: ["600", "700", "800", "900"], subsets: ["latin"] });
anton("normal", { weights: ["400"], subsets: ["latin"] });
archivoBlack("normal", { weights: ["400"], subsets: ["latin"] });
bangers("normal", { weights: ["400"], subsets: ["latin"] });
bebas("normal", { weights: ["400"], subsets: ["latin"] });
inter("normal", { weights: ["600", "700", "800", "900"], subsets: ["latin"] });
oswald("normal", { weights: ["500", "600", "700"], subsets: ["latin"] });
poppins("normal", { weights: ["600", "700", "800", "900"], subsets: ["latin"] });
