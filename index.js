import { existsSync, readFileSync, writeFileSync } from 'fs';

// Load config and cache file
const config = JSON.parse(readFileSync('config.json'));
const cache = existsSync(config.cache_file)
    ? JSON.parse(readFileSync(config.cache_file))
    : {};

async function getIdFromUsername(username) {
    const cached_user = cache[username];
    if (cached_user) return cached_user.id_auteur;

    return fetch(
        "https://api.www.root-me.org/auteurs?nom=" + username,
        { headers: { cookie: 'api_key=' + config.rootmeAPIKey } }
    ).then(async r => {
        const json = await r.json();

        // Handle request errors
        if (json[0]?.error) {
            if (json[0].error.code === 404) throw new Error("Could not find user with name: " + username);
            else throw new Error(json.error);
        }

        // Parse users and make sure there is only one
        let id;

        const users = Object.values(json[0]);
        if (users.length > 1) {
            const perfect_matches = users.filter(u => u.nom === username);
            if (perfect_matches.length > 1) {
                console.error(perfect_matches);
                throw new Error("Found multiple users with name: " + username);
            }

            id = perfect_matches[0].id_auteur;
        } else {
            id = users[0].id_auteur;
        }

        return id;
    });
}

async function getUserData(user_id) {
    return fetch(
        "https://api.www.root-me.org/auteurs/" + user_id,
        { headers: { cookie: 'api_key=' + config.rootmeAPIKey } }
    ).then(async r => {
        const json = await r.json();
        if (Array.isArray(json) && json[0]?.error) {
            throw new Error(json[0].error.message);
        }
        return json;
    });
}

async function sendLeaderboardMessage(users) {
    const description = users
        .sort((a, b) => b.score - a.score)
        .map((u, i) =>
            `**${['🥇', '🥈', '🥉'][i] ?? i + 1 + '.'}** [${u.nom}](https://root-me.org/${encodeURIComponent(u.url_name)}) - \`${u.score}\`pts - \`${u.validations.length}\` solves${u.validations.length != 0 ? ` - Last solve: <t:${u.validations.reduce((r, v) => Math.max(r, Math.round(new Date(v.date).getTime() / 1000)), 0)}:R>` : ''}`
        ).join('\n');

    const edit_id = cache[":webhook_msg_id"];

    return fetch(
        config.webhook_url + (edit_id ? "/messages/" + edit_id : "?wait=true"),
        {
            method: edit_id ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                avatar_url: "https://images.seeklogo.com/logo-png/50/1/root-me-logo-png_seeklogo-505083.png",
                username: "RootMe Leaderboard",
                embeds: [{
                    "title": "🏆 RootMe Leaderboard",
                    "url": "https://root-me.org",
                    description,
                    "image": {
                        "url": "https://picsum.photos/400/200"
                    },
                    "color": 45300,
                    "footer": {
                        "text": "Made with 𖹭 by Tenclea"
                    },
                    "timestamp": new Date().toISOString(),
                }]
            }),
        }
    ).then(async r => {
        const json = await r.json();
        if (!json.id) throw new Error("Failed to send leaderboard update: " + JSON.stringify(json));
        cache[":webhook_msg_id"] = json.id;
        return json;
    });
}

async function sendNewSolveMessage(user, solves, score_gained) {
    if (!config.webhook_thread_id) return;

    const description = `**Score gained**: \`${score_gained}\`pts\n**New rank**: \`#${user.position}\`\n${solves.map(s => `✦ \`${s.titre}\` - <t:${Math.round(new Date(s.date).getTime() / 1000)}:R>`).join('\n') }`;
    const emotes = ["🎉", "🔥", "💪", "✨", "😎", "🏆", "🧠"];
    const kaomojies = ["◝(ᵔᗜᵔ)◜", "٩(^ᗜ^ )و ´-", "ᐠ( ᐛ )ᐟ", "( ◡̀_◡́)ᕤ", "ദ്ദി(ᵔᗜᵔ)", "(•̀ᴗ•́ )و"];

    return fetch(
        config.webhook_url + "?wait=true&thread_id=" + config.webhook_thread_id,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                avatar_url: "https://images.seeklogo.com/logo-png/50/1/root-me-logo-png_seeklogo-505083.png",
                username: "RootMe Leaderboard",
                embeds: [{
                    author: {
                        name: user.nom,
                        icon_url: "https://www.root-me.org/" + user.logo_url,
                        url: "https://root-me.org/" + encodeURIComponent(user.url_name),
                    },
                    title: `\\${emotes[Math.floor(Math.random() * emotes.length)]} ${user.nom} just solved ${solves.length == 1 ? 'a new challenge' : 'new challenges' }! ${kaomojies[Math.floor(Math.random() * kaomojies.length)]}`,
                    description,
                    color: Math.floor(Math.random() * 0xFFFFFF),
                    footer: { "text": "Made with 𖹭 by Tenclea" },
                    timestamp: new Date().toISOString(),
                }]
            }),
        }
    ).then(async r => {
        const json = await r.json();
        if (!json.id) throw new Error(`Failed to send new solves from ${user.nom}: ` + JSON.stringify(json));
        return json;
    });
}

console.log("Script started!");

const data = {};
for (const username of config.usernames) {
    let [name, id, url_name] = username.split(':');

    if (!id) id = await getIdFromUsername(name).catch(err => {
        console.error("Failed to get user id from username: " + name, err);
        process.exit(1);
    });

    const user = await getUserData(id).catch(err => {
        console.error("Failed to fetch user data for id: " + id, err);
        return cache[name];
    });

    // const user = JSON.parse(JSON.stringify(cache[name]));
    if (!user) continue;

    user.url_name = url_name ?? name;

    const previous_data = cache[name] ?? {};
    if (previous_data.nom != user.nom || previous_data.score != user.score) {
        // Make sure that previous_data is not empty
        if (Object.keys(previous_data).length !== 0) {
            const new_solves = user.validations.filter(
                v => !previous_data.validations.some(p => p.id_challenge === v.id_challenge && p.id_rubrique === v.id_rubrique)
            );

            await sendNewSolveMessage(user, new_solves, user.score - previous_data.score);
        }

        cache[name] = user;
    }

    data[name] = user;
}

await sendLeaderboardMessage(Object.values(data));
writeFileSync(config.cache_file, JSON.stringify(cache), 'utf8');
console.log("Script completed!");