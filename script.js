const BASE_URL = "http://100.30.49.178";

async function loginUser() {

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {

        const response = await fetch(`${BASE_URL}/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        const data = await response.json();

        if (data.success) {

            localStorage.setItem("email", data.user.email);
            localStorage.setItem("username", data.user.user_name);

            window.location.href = "main.html";

        } else {

            document.getElementById("message").innerText =
                "email or password is invalid";
        }

    } catch (error) {

        document.getElementById("message").innerText =
            "Unable to connect to server";
    }
}


window.onload = () => {

    const username = localStorage.getItem("username");

    if (document.getElementById("username")) {

        document.getElementById("username").innerText = username;

        loadSubscriptions();
    }
};

function logoutUser() {

    localStorage.clear();

    window.location.href = "login.html";
}

async function searchMusic() {

    const title = document.getElementById("title").value;
    const artist = document.getElementById("artist").value;
    const album = document.getElementById("album").value;
    const year = document.getElementById("year").value;

    let query = [];

    if (title) query.push(`title=${encodeURIComponent(title)}`);
    if (artist) query.push(`artist=${encodeURIComponent(artist)}`);
    if (album) query.push(`album=${encodeURIComponent(album)}`);
    if (year) query.push(`year=${encodeURIComponent(year)}`);

    const response = await fetch(
        `${BASE_URL}/getMusic?${query.join("&")}`
    );

    const data = await response.json();

    const resultsDiv = document.getElementById("results");

    resultsDiv.innerHTML = "";

    if (!data.success || !data.songs || data.songs.length === 0) {

        resultsDiv.innerHTML =
            "<p>No result is retrieved. Please query again</p>";

        return;
    }

    data.songs.forEach(song => {

        const safeSong = encodeURIComponent(JSON.stringify(song));
        const imageUrl = song.img_url || song.image_url || "";

        resultsDiv.innerHTML += `
        
        <div class="music-card">

            <h4>${song.title}</h4>

            <p>Artist: ${song.artist}</p>

            <p>Album: ${song.album}</p>

            <p>Year: ${song.year}</p>

            ${imageUrl ? `<img src="${imageUrl}" alt="${song.artist || "Artist"}">` : `<p>No image available</p>`}

            <br><br>

            <button onclick='subscribeMusic("${safeSong}")'>
                Subscribe
            </button>

        </div>
        `;
    });
}

async function subscribeMusic(encodedSong) {

    const email = localStorage.getItem("email");
    const song = JSON.parse(decodeURIComponent(encodedSong));

    await fetch(`${BASE_URL}/createSub`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            email: email,
            song_id: song.song_id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            year: song.year,
            image_url: song.image_url || "",
            img_url: song.img_url || "",
            image_s3_key: song.image_s3_key || "",
            original_image_url: song.original_image_url || ""
        })
    });

    loadSubscriptions();
}

async function loadSubscriptions() {

    const email = localStorage.getItem("email");

    const response = await fetch(
        `${BASE_URL}/getSub?email=${email}`
    );

    const data = await response.json();

    const subDiv =
        document.getElementById("subscriptions");

    if (!subDiv) return;

    subDiv.innerHTML = "";

    if (!data.subscriptions || data.subscriptions.length === 0) {
        subDiv.innerHTML = "<p>No subscribed music yet.</p>";
        return;
    }

    data.subscriptions.forEach(song => {

        const imageUrl = song.img_url || song.image_url || "";

        subDiv.innerHTML += `
        
        <div class="music-card">

            <h4>${song.title}</h4>

            <p>Artist: ${song.artist || ""}</p>

            <p>Album: ${song.album || ""}</p>

            <p>Year: ${song.year || ""}</p>

            ${imageUrl ? `<img src="${imageUrl}" alt="${song.artist || "Artist"}">` : `<p>No image available</p>`}

            <button onclick='deleteSubscription(
                "${song.title}"
            )'>
                Remove
            </button>

        </div>
        `;
    });
}

async function deleteSubscription(title) {

    const email = localStorage.getItem("email");

    await fetch(`${BASE_URL}/deleteSub`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            email,
            title
        })
    });

    loadSubscriptions();
}


async function registerUser() {

    const email =
        document.getElementById("regEmail").value;

    const user_name =
        document.getElementById("regUsername").value;

    const password =
        document.getElementById("regPassword").value;

    try {

        const response = await fetch(
            `${BASE_URL}/register`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email,
                    user_name,
                    password
                })
            }
        );

        const data = await response.json();

        if (data.success) {

            alert("Registration successful");

            window.location.href = "login.html";

        } else {

            document.getElementById("registerMessage")
                .innerText = data.message;
        }

    } catch (error) {

        document.getElementById("registerMessage")
            .innerText = "Unable to connect to server";
    }
}