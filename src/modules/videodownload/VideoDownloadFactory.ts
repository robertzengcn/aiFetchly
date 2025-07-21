import {YoutubeDownload} from "@/modules/videodownload/youtubeDownload"
import {VideoDownloadImpl} from "@/modules/interface/videoDownloadImpl"


export class VideoDownloadFactory {
    static getDownloader(platform: string):VideoDownloadImpl {
        switch (platform) {
            case 'youtube':
                return new YoutubeDownload();
            // Add more cases for other platforms as needed
            default:
                throw new Error('Unsupported platform');
        }
    }
    
}

