import { ExtraModule } from "@/entityTypes/extramoduleType";
export const LinuxExtraModuleConfig:ExtraModule[]=[

    {
        name:"youtube-dl",
        // description:"video download is a module that can download video from tiktok, Instagram and other platforms",
        packagename:"yt-dlp",
        version:"2025.06.30",
        link:"https://github.com/yt-dlp/yt-dlp/releases/download/2025.06.30/yt-dlp_linux",
        requirePy:true,
        ispip:false,
        requireFfmpeg:true
    },
    {
        name:"openai-whisper",
        packagename:"openai-whisper",
        version:"v20240930",
        link:"https://github.com/openai/whisper",
        requirePy:true,
        ispip:true,
        requireFfmpeg:true
    }

]