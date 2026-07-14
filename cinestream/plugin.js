(function() {
    const mainUrl = "https://cinemeta-catalogs.strem.io";
    const cinemetaUrl = "https://v3-cinemeta.strem.io";

    async function fetch(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const headers = options.headers || {};
        let res;
        try {
            if (method === 'POST') {
                res = await http_post(url, headers, options.body || "");
            } else {
                res = await http_get(url, headers);
            }
        } catch (e) {
            console.error("fetch failed", e);
            throw e;
        }
        if (!res) res = { status: 500, body: "" };
        return {
            status: res.status,
            text: async () => res.body,
            json: async () => JSON.parse(res.body)
        };
    }

    async function getHome(cb) {
        try {
            const [moviesRes, seriesRes] = await Promise.all([
                fetch(`${mainUrl}/top/catalog/movie/top.json`),
                fetch(`${mainUrl}/top/catalog/series/top.json`)
            ]);

            const moviesJson = await moviesRes.json();
            const seriesJson = await seriesRes.json();

            const parseMetas = (metas, defaultType) => {
                if (!metas || !Array.isArray(metas)) return [];
                return metas.map(m => new MultimediaItem({
                    title: m.name,
                    url: `${cinemetaUrl}/meta/${m.type || defaultType}/${m.id}.json`,
                    posterUrl: m.poster || "",
                    type: (m.type || defaultType) === "series" ? "series" : "movie",
                    year: m.releaseInfo ? parseInt(m.releaseInfo) : undefined
                }));
            };

            cb({ 
                success: true, 
                data: { 
                    "Trending Movies": parseMetas(moviesJson.metas, "movie"),
                    "Trending Series": parseMetas(seriesJson.metas, "series")
                } 
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: String(e) });
        }
    }

    async function search(query, cb) {
        try {
            const [moviesRes, seriesRes] = await Promise.all([
                fetch(`${cinemetaUrl}/catalog/movie/top/search=${encodeURIComponent(query)}.json`),
                fetch(`${cinemetaUrl}/catalog/series/top/search=${encodeURIComponent(query)}.json`)
            ]);

            const moviesJson = await moviesRes.json();
            const seriesJson = await seriesRes.json();

            let results = [];
            
            if (moviesJson && moviesJson.metas) {
                results = results.concat(moviesJson.metas.map(m => new MultimediaItem({
                    title: m.name,
                    url: `${cinemetaUrl}/meta/movie/${m.id}.json`,
                    posterUrl: m.poster || "",
                    type: "movie",
                    year: m.releaseInfo ? parseInt(m.releaseInfo) : undefined
                })));
            }

            if (seriesJson && seriesJson.metas) {
                results = results.concat(seriesJson.metas.map(m => new MultimediaItem({
                    title: m.name,
                    url: `${cinemetaUrl}/meta/series/${m.id}.json`,
                    posterUrl: m.poster || "",
                    type: "series",
                    year: m.releaseInfo ? parseInt(m.releaseInfo) : undefined
                })));
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) });
        }
    }

    async function load(url, cb) {
        try {
            const res = await fetch(url);
            const json = await res.json();
            
            if (!json || !json.meta) {
                return cb({ success: false, errorCode: "PARSE_ERROR", message: "No meta data found" });
            }
            
            const meta = json.meta;
            const type = meta.type === "series" ? "series" : "movie";
            
            const cast = (meta.cast || []).map(name => new Actor({ name }));
            const tags = meta.genres || [];
            
            let episodes = [];
            let movieStreamsUrl = "";

            if (type === "series") {
                if (meta.videos) {
                    episodes = meta.videos.map(v => {
                        const sNum = parseInt(v.season || 1);
                        const eNum = parseInt(v.episode || 1);
                        
                        const streamData = {
                            imdbId: meta.id,
                            tmdbId: meta.moviedb_id || null,
                            title: meta.name,
                            season: sNum,
                            episode: eNum,
                            type: "series"
                        };

                        return new Episode({
                            name: v.name || `Episode ${eNum}`,
                            url: JSON.stringify(streamData),
                            season: sNum,
                            episode: eNum,
                            posterUrl: meta.poster,
                            description: v.overview
                        });
                    });
                }
            } else {
                const streamData = {
                    imdbId: meta.id,
                    tmdbId: meta.moviedb_id || null,
                    title: meta.name,
                    season: null,
                    episode: null,
                    type: "movie"
                };
                movieStreamsUrl = JSON.stringify(streamData);
            }

            const item = new MultimediaItem({
                title: meta.name,
                url: type === "series" ? url : movieStreamsUrl,
                posterUrl: meta.poster || "",
                bannerUrl: meta.background || "",
                type: type,
                description: meta.description || "", 
                year: meta.releaseInfo ? parseInt(meta.releaseInfo) : undefined,
                score: meta.imdbRating ? parseFloat(meta.imdbRating) : undefined,
                duration: meta.runtime ? parseInt(meta.runtime) : undefined,
                tags: tags,
                cast: cast,
                episodes: episodes,
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e) });
        }
    }

    async function loadStreams(url, cb) {
        try {
            let streamInfo;
            try {
                streamInfo = JSON.parse(url);
            } catch (e) {
                return cb({ success: false, errorCode: "INVALID_URL", message: "Stream info missing" });
            }
            
            const { imdbId, tmdbId, title, season, episode, type } = streamInfo;
            let streamResults = [];

            // Execute extractors
            const extractors = [
                invokeShowbox(imdbId, tmdbId, season, episode),
                invokeVidrock(imdbId, tmdbId, season, episode),
                invokeHexa(imdbId, tmdbId, season, episode)
            ];

            const results = await Promise.allSettled(extractors);
            results.forEach(r => {
                if (r.status === 'fulfilled' && r.value) {
                    streamResults = streamResults.concat(r.value);
                }
            });

            cb({ success: true, data: streamResults });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
        }
    }

    // Extractor: ShowBox
    async function invokeShowbox(imdbId, season, episode) {
        if (!imdbId) return [];
        try {
            const baseUrl = "https://showbox.shegu.net/api/api_client/res";
            const appKey = "JvlamMBqy6BMe";
            const appId = "136";
            // Needs to be fully ported...
            return [];
        } catch(e) {
            return [];
        }
    }

    // Extractor: Vidrock
    async function invokeVidrock(imdbId, tmdbId, season, episode) {
        if (!tmdbId) return [];
        try {
            const CryptoJS = require("crypto-js");
            const type = season == null ? "movie" : "tv";
            const query = type === "movie" ? `${tmdbId}` : `${tmdbId}_${season}_${episode}`;
            
            // AES Encryption
            const passphrase = "x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9";
            const key = CryptoJS.enc.Utf8.parse(passphrase);
            const iv = CryptoJS.lib.WordArray.create(key.words.slice(0, 4));
            const encrypted = CryptoJS.AES.encrypt(query, key, { iv: iv, padding: CryptoJS.pad.Pkcs7, mode: CryptoJS.mode.CBC });
            const base64 = encrypted.toString();
            const urlEncoded = encodeURIComponent(base64).replace(/%2F/g, "/");

            const apiUrl = `https://vidrock.ru/api/${type}/${urlEncoded}`;
            const headers = {
                "Origin": "https://vidrock.ru",
                "Referer": "https://vidrock.ru/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
            };

            const response = await fetch(apiUrl, { headers });
            const json = await response.json();
            
            let streams = [];
            for (const serverName in json) {
                const serverData = json[serverName];
                const url = serverData.url;
                if (url && url !== "error" && url !== "null" && serverName !== "Astra" && serverName !== "Atlas") {
                    streams.push(new ExtractorLink({
                        name: `Vidrock [${serverName}]`,
                        url: url,
                        type: url.includes(".m3u8") ? "m3u8" : "video/mp4"
                    }));
                }
            }
            return streams;
        } catch(e) {
            console.error("Vidrock error", e);
            return [];
        }
    }

    // Extractor: Hexa
    async function invokeHexa(imdbId, tmdbId, season, episode) {
        if (!tmdbId) return [];
        try {
            const multiDecryptAPI = "https://enc-dec.app/api";
            const hexaAPI = "https://theemoviedb.hexa.su";
            
            const url = season == null 
                ? `${hexaAPI}/api/tmdb/movie/${tmdbId}/images` 
                : `${hexaAPI}/api/tmdb/tv/${tmdbId}/season/${season}/episode/${episode}/images`;

            // Generate 32 char hex key
            const chars = "0123456789abcdef";
            let key = "";
            for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)];

            const tokenRes = await fetch(`${multiDecryptAPI}/enc-hexa`);
            const tokenJson = await tokenRes.json();
            const token = tokenJson.result.token;

            const headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
                "Accept": "text/plain",
                "X-Api-Key": key,
                "X-Fingerprint-Lite": "e9136c41504646444",
                "Referer": "https://hexa.su/",
                "X-Cap-Token": token
            };

            const encDataRes = await fetch(url, { headers });
            const encDataText = await encDataRes.text();

            const decRes = await fetch(`${multiDecryptAPI}/dec-hexa`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: encDataText, key: key })
            });

            if (decRes.status !== 200) return [];
            
            const decJson = await decRes.json();
            const sources = decJson.result.sources || [];
            
            let streams = [];
            for (let i = 0; i < sources.length; i++) {
                const src = sources[i];
                streams.push(new ExtractorLink({
                    name: `Hexa [${src.quality}]`,
                    url: src.file,
                    type: src.file.includes(".m3u8") ? "m3u8" : "video/mp4"
                }));
            }
            return streams;
        } catch(e) {
            console.error("Hexa error", e);
            return [];
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
