import fs from "fs";
import crypto from "crypto";
import http from "http";
import https from "https";
import progress from "progress-stream";
// const fetch =require("node-fetch");
import fetch from 'node-fetch';
//import { RequestInfo, RequestInit } from "node-fetch";
//const fetch = (url: RequestInfo, init?: RequestInit) =>  import("node-fetch").then(({ default: fetch }) => fetch(url, init));
// const debug = require("debug")("bilibili-download");
// const debugerror = debug('app:error');
export interface getAiddata {
	videoData: {
		aid: number;
		pages: Array<{
			cid: number;
		}>;
	};

	epInfo: {
		aid: number;
		cid: number;
	}
	epList: Array<{
		aid: number;
		cid: number;
	}>;
}
type Durldata = {
	url: string;
	order: string;
	length: string;
	size: string;
}
type Targetresult = {
	durl: Array<Durldata>;
	quality: string;
}
export type Videodata = {
	data: {
		title: string;
	}
}
class Task {
	url: string;
	finished: boolean;
	constructor(url) {
		this.url = url;
		this.finished = false;
	}
}


export class Downloader {
	type: string;
	id: string;
	url: string;
	aid: number;
	pid: number;
	cid: number;
	name: string;
	links: Array<string>;
	tasks: Array<Task>;

	constructor() {
		this.type = "";
		this.id = "";
		this.url = "";
		this.aid = -1;
		this.pid = 1;
		this.cid = -1;
		this.name = "";
		this.links = [];
		this.tasks = [];
	}

	getVideoUrl(videoUrl: string): void {
		if(!videoUrl){
			throw new Error("video url is empty");
		} 
		this.url = "";
		const mapping = {
			"BV": "https://www.bilibili.com/video/",
			"bv": "https://www.bilibili.com/video/",
			"av": "https://www.bilibili.com/video/",
			"ep": "https://www.bilibili.com/bangumi/play/",
			"ss": "https://www.bilibili.com/bangumi/play/"
		};
		for (const [key, value] of Object.entries(mapping)) {
			if (videoUrl.includes(key)) {
				this.type = key;
				this.id = key + videoUrl.split(key)[1];
				this.url = value + this.id;
				break;
			}
		}
	}

	async getAid() {
		const { type, url } = this;
		if (!url) return;
		return fetch(url)
			.then(response => response.text())
			.then(result => {
				const match = result.match(/__INITIAL_STATE__=(.*?);\(function\(\)/);
				const data = match ? match[1] : null;
				// data =  cast(JSON.parse(data),r("User"));
				if(!data){
					throw new Error("get video aid error");
				}
				const aiddata: getAiddata = JSON.parse(data)
				//debug("INITIAL STATE", data);
				if (type === "BV" || type === "bv" || type === "av") {
					this.aid = aiddata.videoData.aid;
					this.pid = parseInt(url.split("p=")[1], 10) || 1;
					this.cid = aiddata.videoData.pages[this.pid - 1].cid;
				}
				else if (type === "ep") {
					this.aid = aiddata.epInfo.aid;
					this.cid = aiddata.epInfo.cid;
				}
				else if (type === "ss") {
					this.aid = aiddata.epList[0].aid;
					this.cid = aiddata.epList[0].cid;
				}
			})
			.catch(
				// error => showError("获取视频 aid 出错！")
				function (error) {
					// console.error(error);
					throw new Error("get video aid error");
				}
			);
	}

	async getInfo(): Promise<Videodata> {
		const { aid, cid } = this;
		if (!cid) {
			throw new Error("get video cid error");
			// showError("获取视频 cid 出错！");
			// return;
		}
		// getDanmaku(); //获取cid后，获取下载链接和弹幕信息
		return fetch("https://api.bilibili.com/x/web-interface/view?aid=" + aid)
			.then(response => response.json() as Promise<Videodata>)
			.catch(
				function (error) {
					// console.error(error);
					throw new Error("get video info error");
				}
				// error => showError("获取视频信息出错！")
			);
	}

	async getData(fallback = false) {
		const { cid, type } = this;
		let playUrl;
		if (fallback) {
			const params = `cid=${cid}&module=movie&player=1&quality=112&ts=1`;
			const sign = crypto.createHash("md5").update(params + "9b288147e5474dd2aa67085f716c560d").digest("hex");
			playUrl = `https://bangumi.bilibili.com/player/web_api/playurl?${params}&sign=${sign}`;
		} else {
			if (type === "BV" || type === "bv" || type === "av") {
				const params = `appkey=iVGUTjsxvpLeuDCf&cid=${cid}&otype=json&qn=112&quality=112&type=`;
				const sign = crypto.createHash("md5").update(params + "aHRmhWMLkdeMuILqORnYZocwMBpMEOdt").digest("hex");
				playUrl = `https://interface.bilibili.com/v2/playurl?${params}&sign=${sign}`;
			} else {
				playUrl = `https://api.bilibili.com/pgc/player/web/playurl?qn=80&cid=${cid}`;

			}
		}
		return fetch(playUrl)
			.then(response => response.text())
			.then(result => {
				const data = fallback ? this.parseData(result) : JSON.parse(result);
				const target = data.durl || data.result.durl;
				// console.log("PLAY URL", data);
				if (target) {
					this.links = target.map(part => part.url);
					return {
						fallback, data
					};
				} else {
					if (fallback) throw Error();
					return this.getData(true);
				}
			})
			.catch(
				function (error) {
					// console.error(error);
					throw new Error("get playUrl or download link error");
				}
				// 	error => {
				// 	// showError("获取 PlayUrl 或下载链接出错！由于B站限制，只能下载低清晰度视频。");
				// }
			);
	}

	parseData(target) {
		const data = $(target);
		const result: Targetresult = { durl: [], quality: "" };
		result.durl = [];
		result.quality = data.find("quality").text();
		data.find("durl").each((i, o) => {
			const part = $(o);
			result.durl.push({
				url: part.find("url").text(),
				order: part.find("order").text(),
				length: part.find("length").text(),
				size: part.find("size").text()
			});
		});
		return result;
	}

	downloadByIndex(part, file, callback = (progress: any, index: any) => { 
		console.log(progress)
	}) {
		const { url } = this;

		if (this.tasks.some(item => item.url === this.links[part])) return "DUPLICATE";
		this.tasks.push(new Task(this.links[part]));
		let state;
		try {
			state = fs.statSync(file);
		}
		catch (error) {
			console.log(error)
		}
		const options = {
			url: this.links[part],
			headers: {
				"Range": `bytes=${state ? state.size : 0}-`, //断点续传
				"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
				"Referer": url
			}
		};
		const stream = fs.createWriteStream(file, state ? { flags: "a" } : {});
		this.download(options, stream, callback);

		return state;
	}

	download(options, stream, callback) {
		// https://www.npmjs.com/package/progress-stream
		const index = this.tasks.findIndex(item => item.url === options.url);
		const proStream = progress({
			time: 250 //单位ms
		}).on("progress", progress => {
			const { percentage } = progress; //显示进度条
			if (percentage === 100) {
				this.tasks[index].finished = true;
			}
			callback(progress, index);
		});

		const { url } = options;
		function downloadLink(url) {
			(url.startsWith("https") ? https : http).get(url, options, res => {
				if (res.statusCode === 302) {
					url = res.headers.location;
					return downloadLink(url);
				}
				proStream.setLength(res.headers["content-length"]);
				//先pipe到proStream再pipe到文件的写入流中
				res.pipe(proStream).pipe(stream).on("error", error => {
					// debugerror(error);
				});
			});
		}
		downloadLink(url);
	}
}

module.exports = { Task, Downloader };
