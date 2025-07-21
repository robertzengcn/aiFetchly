'use strict';
export {};
//import {LanguageItem} from '@/entityTypes/commonType'
import {LanguageCode} from '@/entityTypes/commonType'
import {Vpformconfig} from '@/entityTypes/videoType'
import {PublishPlatform} from '@/entityTypes/videoPublishType'

export enum VideoPublishCategory {
    SOCIAL_MEDIA = 'social_media',
    VIDEO_PLATFORM = 'video_platform',
    SEARCH_ENGINE = 'search_engine'
}

export const VideoDownloadlist=[
    'youtube'
]
export const VideodownlodType=[
    'singleplay','playlist','keyword'
]
export const CookiesSelectType=[
    'browser cookies','account cookies'
]
export const BrowerList=[
    'brave', 'chrome', 'chromium', 'edge', 'firefox','opera', 'safari', 'vivaldi', 'whale'
]

// Platform-specific video categories
export const YouTubeCategories = [
    'Film & Animation',
    'Autos & Vehicles',
    'Music',
    'Pets & Animals',
    'Sports',
    'Travel & Events',
    'Gaming',
    'People & Blogs',
    'Comedy',
    'Entertainment',
    'News & Politics',
    'Howto & Style',
    'Education',
    'Science & Technology',
    'Nonprofits & Activism'
]

export const BilibiliCategories = [
    '动画',
    '音乐',
    '舞蹈',
    '游戏',
    '知识',
    '科技',
    '运动',
    '生活',
    '时尚',
    '娱乐',
    '影视',
    '美食',
    '动物圈',
    '汽车',
    '鬼畜'
]

export const BaiduCategories = [
    '娱乐',
    '体育',
    '科技',
    '教育',
    '财经',
    '汽车',
    '游戏',
    '时尚',
    '旅游',
    '美食',
    '健康',
    '军事',
    '社会',
    '文化',
    '生活'
]

export const VideoPublishPlatformConfig:Vpformconfig[]=[
    {
        name:PublishPlatform.YOUTUBE,
        language:LanguageCode.EN,
        //category: VideoPublishCategory.VIDEO_PLATFORM,
        videoCategories: YouTubeCategories
    },
    {
        name:PublishPlatform.BILIBILI,
        language:LanguageCode.ZH,
        //category: VideoPublishCategory.VIDEO_PLATFORM,
        videoCategories: BilibiliCategories
    },
    {
        name:PublishPlatform.BAIDU,
        language:LanguageCode.ZH,
        //category: VideoPublishCategory.SEARCH_ENGINE,
        videoCategories: BaiduCategories
    }
]

