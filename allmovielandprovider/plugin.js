(function() {
    const mainUrl = "https://allmovieland.fun";

    function fixUrl(url) {
        if (!url) return url;
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return mainUrl + url;
        return url;
    }

    async function fetch(url, options = {}) {
        try {
            const config = {
                url: url,
                method: options.method || 'GET',
                headers: options.headers || {},
                data: options.body
            };
            const res = await axios(config);
            return {
                text: async () => typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
                json: async () => typeof res.data === 'string' ? JSON.parse(res.data) : res.data,
                status: res.status
            };
        } catch (e) {
            if (e.response) {
                return {
                    text: async () => typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data),
                    json: async () => typeof e.response.data === 'string' ? JSON.parse(e.response.data) : e.response.data,
                    status: e.response.status
                };
            }
            throw e;
        }
    }

    async function getHome(cb) {
        try {
            const res = await fetch(mainUrl + "/");
            const html = await res.text();
            
            let movies = [];
            const articles = html.split('class="short-mid"').slice(1);
            for (let art of articles) {
                const titleMatch = art.match(/<h3[^>]*>([^<]+)<\/h3>/i) || art.match(/title="([^"]+)"/i);
                const hrefMatch = art.match(/<a[^>]+href="([^"]+)"/i);
                const posterMatch = art.match(/data-src="([^"]+)"/i) || art.match(/src="([^"]+)"/i);
                
                if (titleMatch && hrefMatch) {
                    movies.push(new MultimediaItem({
                        title: titleMatch[1].trim(),
                        url: fixUrl(hrefMatch[1]),
                        posterUrl: posterMatch ? fixUrl(posterMatch[1]) : "",
                        type: "movie",
                        headers: { "Referer": mainUrl + "/" }
                    }));
                }
            }

            cb({ 
                success: true, 
                data: { 
                    "Latest Movies": movies
                } 
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: String(e) });
        }
    }

    async function search(query, cb) {
        try {
            const body = new URLSearchParams();
            body.append("do", "search");
            body.append("subaction", "search");
            body.append("search_start", "0");
            body.append("full_search", "0");
            body.append("result_from", "1");
            body.append("story", query);

            const res = await fetch(`${mainUrl}/index.php?do=opensearch`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": `${mainUrl}/`
                },
                body: body.toString()
            });
            const html = await res.text();

            let results = [];
            const articles = html.split('class="short-mid"').slice(1);
            for (let art of articles) {
                const titleMatch = art.match(/<h3[^>]*>([^<]+)<\/h3>/i) || art.match(/title="([^"]+)"/i);
                const hrefMatch = art.match(/<a[^>]+href="([^"]+)"/i);
                const posterMatch = art.match(/data-src="([^"]+)"/i) || art.match(/src="([^"]+)"/i);
                const checkTypeMatch = art.match(/class="new-short__cats"[^>]*>([^<]+)<\/span>/i);
                const checkType = checkTypeMatch ? checkTypeMatch[1] : "";
                
                let type = "movie";
                if (checkType.toLowerCase().includes("series")) type = "series";
                else if (checkType.toLowerCase().includes("cartoon")) type = "anime";

                if (titleMatch && hrefMatch) {
                    results.push(new MultimediaItem({
                        title: titleMatch[1].trim(),
                        url: fixUrl(hrefMatch[1]),
                        posterUrl: posterMatch ? fixUrl(posterMatch[1]) : "",
                        type: type,
                        headers: { "Referer": mainUrl + "/" }
                    }));
                }
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) });
        }
    }

    async function load(url, cb) {
        try {
            const res = await fetch(url);
            const html = await res.text();

            const titleMatch = html.match(/<h1[^>]*class="fs__title"[^>]*>([^<]+)<\/h1>/i);
            const title = titleMatch ? titleMatch[1].trim() : "Unknown Title";
            
            const posterMatch = html.match(/<img[^>]*class="fs__poster-img"[^>]*src="([^"]+)"/i);
            const posterUrl = posterMatch ? fixUrl(posterMatch[1]) : "";
            
            const yearMatch = title.match(/\((\d{4})\)/);
            const year = yearMatch ? parseInt(yearMatch[1]) : undefined;
            
            // Fix: better description extraction
            const descMatches = [...html.matchAll(/<div[^>]*class="fs__descr--text"[^>]*>([\s\S]*?)<\/div>/gi)];
            let description = "";
            if (descMatches.length > 0) {
                 description = descMatches[0][1].replace(/<[^>]+>/g, "").trim();
            }
            
            const tagsMatches = [...html.matchAll(/<div[^>]*itemprop="genre"[^>]*>([\s\S]*?)<\/div>/gi)];
            let tags = [];
            if (tagsMatches.length > 0) {
                 const aTags = [...tagsMatches[0][1].matchAll(/<a[^>]*>([^<]+)<\/a>/gi)];
                 tags = aTags.map(m => m[1].trim());
            }
            
            const tagsStr = tags.join(", ").toLowerCase();
            let type = "movie";
            if (tagsStr.includes("series")) type = "series";
            else if (tagsStr.includes("cartoon")) type = "anime";

            const ratingMatch = html.match(/<b[^>]*class="imdb__value"[^>]*>([^<]+)<\/b>/i);
            const ratingStr = ratingMatch ? ratingMatch[1].replace(",", ".") : "";
            const rating = parseFloat(ratingStr) || undefined;
            
            const durationMatch = html.match(/<li[^>]*class="xfs__item_op"[^>]*>[\s\S]*?<\/li>[\s\S]*?<li[^>]*class="xfs__item_op"[^>]*>[\s\S]*?<\/li>[\s\S]*?<li[^>]*class="xfs__item_op"[^>]*>[\s\S]*?<b[^>]*>([^<]+)<\/b>/i);
            const durationStr = durationMatch ? durationMatch[1].replace(" min.", "").trim() : "";
            const duration = parseInt(durationStr) || undefined;
            
            const actorsMatch = html.match(/<b[^>]*itemprop="actors"[^>]*>([\s\S]*?)<\/b>/i);
            const actorsText = actorsMatch ? actorsMatch[1].replace(/<[^>]+>/g, "").trim() : "";
            const cast = actorsText ? actorsText.split(",").map(name => new Actor({ name: name.trim() })) : [];

            const trailers = [];
            const trailerMatch = html.match(/<div[^>]*id="player"[^>]*>[\s\S]*?<iframe[^>]*src="([^"]+)"/i);
            const trailerSrc = trailerMatch ? trailerMatch[1] : null;
            if (trailerSrc && trailerSrc.includes('youtube')) {
                trailers.push(new Trailer({ url: fixUrl(trailerSrc) }));
            }

            // Extract player id
            const idMatch = html.match(/(?:src:.')+(\D.*\d)/);
            const id = idMatch ? idMatch[1] : null;

            // Extract player script domain
            // Look for script right before id script
            const scriptsMatch = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/gi)];
            // Finding the AwsIndStreamDomain
            let playerDomain = null;
            for(let script of scriptsMatch) {
                 if(script[1].includes('player')) {
                      try {
                          let playerScriptUrl = script[1];
                          if(playerScriptUrl.startsWith('//')) playerScriptUrl = 'https:' + playerScriptUrl;
                          const playerScriptRes = await fetch(playerScriptUrl);
                          const playerScriptCode = await playerScriptRes.text();
                          const domainMatch = playerScriptCode.match(/const AwsIndStreamDomain.*'(.*)';/);
                          if(domainMatch) {
                              playerDomain = domainMatch[1];
                              break;
                          }
                      } catch(e) {}
                 }
            }
            
            // Backup regex search
            if(!playerDomain) {
                const domainMatch = html.match(/const AwsIndStreamDomain.*'(.*)';/);
                if(domainMatch) playerDomain = domainMatch[1];
            }

            if (!id || !playerDomain) {
                return cb({ success: false, errorCode: "NO_PLAYER_ID", message: "Could not find player ID or domain" });
            }

            const embedLink = `${playerDomain}/play/${id}`;
            const dlRes = await fetch(embedLink, { headers: { "Referer": url } });
            const dlHtml = await dlRes.text();
            
            const jsonStringMatch = dlHtml.match(/\{.*\}/);
            const dlJson = jsonStringMatch ? JSON.parse(jsonStringMatch[0]) : null;

            if (!dlJson || !dlJson.key) {
                return cb({ success: false, errorCode: "NO_KEY", message: "Could not fetch stream key" });
            }

            const tokenKey = dlJson.key;
            const langsRes = await fetch(`https://${dlJson.href}${dlJson.file}`, {
                method: "POST",
                headers: {
                    "X-CSRF-TOKEN": tokenKey,
                    "Referer": embedLink
                }
            });
            let m3u8LangsText = await langsRes.text();
            m3u8LangsText = m3u8LangsText.replace(/,\s*\[\]/g, "");
            
            let dlData = [];
            try {
                dlData = JSON.parse(m3u8LangsText);
            } catch(e) {
                console.error("Failed to parse dlData JSON", e);
            }

            let episodes = [];
            let movieStreamsUrl = url;

            if (type === "series") {
                if (dlData.length > 0 && dlData[0].folder) {
                    dlData.forEach(season => {
                        const sNum = parseInt(season.id);
                        if (season.folder) {
                            season.folder.forEach(ep => {
                                const eNum = parseInt(ep.episode);
                                const files = (ep.folder || []).map(f => ({ ...f, tokenKey, playerDomain }));
                                episodes.push(new Episode({
                                    name: ep.title || `Episode ${eNum}`,
                                    url: JSON.stringify(files),
                                    season: sNum,
                                    episode: eNum,
                                    posterUrl: posterUrl
                                }));
                            });
                        }
                    });
                } else {
                    const files = dlData.map(f => ({ ...f, tokenKey, playerDomain }));
                    episodes.push(new Episode({
                        name: "1 episode",
                        url: JSON.stringify(files),
                        season: 1,
                        episode: 1,
                        posterUrl: posterUrl
                    }));
                }
            } else {
                const files = dlData.map(f => ({ ...f, tokenKey, playerDomain }));
                movieStreamsUrl = JSON.stringify(files);
            }

            cb({ 
                success: true, 
                data: new MultimediaItem({
                    title: title,
                    url: movieStreamsUrl,
                    posterUrl: posterUrl,
                    type: type,
                    description: description, 
                    year: year,
                    score: rating,
                    duration: duration,
                    tags: tags,
                    cast: cast,
                    trailers: trailers,
                    episodes: type === "series" ? episodes : [],
                    headers: { "Referer": mainUrl + "/" } 
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e) });
        }
    }

    async function loadStreams(url, cb) {
        try {
            let files = [];
            try {
                files = JSON.parse(url);
            } catch (e) {
                return cb({ success: false, errorCode: "INVALID_URL", message: "Stream info not encoded in URL properly." });
            }

            let streamResults = [];
            
            for (let it of files) {
                if (!it.file || !it.tokenKey || !it.playerDomain) continue;
                
                const m3u8Res = await fetch(`${it.playerDomain}/playlist/${it.file}.txt`, {
                    method: 'POST',
                    headers: {
                        "X-CSRF-TOKEN": it.tokenKey,
                        "Referer": `${mainUrl}/`
                    }
                });
                const m3u8Url = await m3u8Res.text();

                if (m3u8Url && m3u8Url.startsWith("http")) {
                    streamResults.push(new StreamResult({ 
                        url: m3u8Url.trim(), 
                        quality: "Unknown",
                        source: `AllMovieLand - ${it.title || "Direct"}`, 
                        headers: { "Referer": mainUrl + "/" }
                    }));
                }
            }

            cb({ success: true, data: streamResults });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
