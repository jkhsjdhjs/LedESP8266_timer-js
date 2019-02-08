import cfg from "../config.json";
import WebSocket from "ws";

const send_message = (ws, message) => new Promise((resolve, reject) => {
    const message_cb = reply => {
        resolve(reply);
    };
    ws.on("message", message_cb);
    ws.send(message);
    setTimeout(() => {
        ws.removeAllListeners();
        reject("timed out waiting for message reply!");
    }, cfg.reply_timeout);
});

const get_color = ws => send_message(ws, JSON.stringify({
    type: "command",
    msg: "get"
}));

const set_color = (ws, color, fade_time) => send_message(ws, JSON.stringify({
    type: "command",
    msg: "set",
    data: {
        color: color,
        fade_time: fade_time
    }
}));

let current_state_index = -1;

const next_state_index = () =>
    current_state_index + 1 < cfg.states.length
    ? current_state_index + 1
    : 0;

const current_state = () => cfg.states[current_state_index];

const color_compare = (c1, c2) =>
    c1.red === c2.red
 && c1.green === c2.green
 && c1.blue === c2.blue;

const date_add_state_runtime = (date, duration) => {
    const splitted = duration.split(":");
    date.setHours(
        date.getHours() + splitted[0],
        date.getMinutes() + splitted[1],
        date.getSeconds() + splitted[2]
    );
    return date;
}

const interval = async (ws, color) => {
    try {
        if(!color) {
            console.log("requesting color...")
            try {
                color = await get_color(ws);
            }
            catch(error) {
                if(error !== "timed out waiting for message reply!")
                    throw error;
                console.warn("timed out waiting for message reply, retrying...");
                color = await get_color(ws);
            }
            console.log("color received!");
            color = JSON.parse(color).data.color;
        }
        if(color_compare(color, current_state().color))
            console.log("correct color is already active!");
        else {
            console.log("setting color...");
            try {
                await set_color(ws, current_state().color, cfg.state_transition_fade_time);
            }
            catch(error) {
                if(error !== "timed out waiting for message reply!")
                    throw error;
                console.warn("timed out waiting for message reply, retrying...");
                await set_color(ws, current_state().color, cfg.state_transition_fade_time);
            }
            console.log("color set!");
        }
    }
    catch(error) {
        console.error(error);
    }
};

const change_state_timeout = async ws => {
    try {
        console.log("changed state!");
        current_state_index = next_state_index();
        console.log("setting color...");
        try {
            await set_color(ws, current_state().color, cfg.state_transition_fade_time)
        }
        catch(error) {
            if(error !== "timed out waiting for message reply!")
                throw error;
            console.warn("timed out waiting for message reply, retrying...");
            await set_color(ws, current_state.color(), cfg.state_transition_fade_time);
        }
        console.log("color set!");
        const now = new Date();
        const timeout = date_add_state_runtime(new Date(now), current_state().duration);
        setTimeout(change_state_timeout, ~~(timeout - now), ws);
    }
    catch(error) {
        console.error(error);
    }
};



(() => {
    try {
        const is_number = n => typeof n === "number" && !Number.isNaN(n);
        if(typeof cfg.url !== "string")
            throw "\"url\" isn't a string";
        if(!is_number(cfg.check_interval))
            throw "\"check_interval\" isn't a number!";
        if(!is_number(cfg.reconnect_interval))
            throw "\"reconnect_interval\" isn't a number!";
        if(!is_number(cfg.reply_timeout))
            throw "\"reply_timeout\" isn't a number!";
        if(!is_number(cfg.state_transition_fade_time))
            throw "\"state_transition_fade_time\" isn't a number!";
        if(!Array.isArray(cfg.states))
            throw "\"states\" isn't an array!";
        if(!cfg.states.every(s =>
            typeof s.duration === "string"
         && /\d+:\d{2}:\d{2}/.test(s.duration)
         && s.color
         && typeof s.color.red === "number"
         && typeof s.color.green === "number"
         && typeof s.color.blue === "number"
         && s.color.red >= 0
         && s.color.green >= 0
         && s.color.blue >= 0
         && s.color.red < 4096
         && s.color.green < 4096
         && s.color.blue < 4096
        ))
            throw "a state in the doesn't match the spec!";
    }
    catch(error) {
        console.error(error);
        console.error("config check failed!");
        process.exit(1);
    }
})();

(() => {
    let ws = new WebSocket(cfg.url);
    let interval_ref;
    
    const event_listener_open = () => {
        console.log("connected!");
        interval(ws);
        interval_ref = setInterval(interval, cfg.check_interval, ws);
        change_state_timeout(ws);
    }
    
    const event_listener_error = error => {
        console.error("a websocket error occured!");
        console.error(error);
    };
    
    const event_listener_close = async (code, reason) => {
        clearInterval(interval_ref);
        ws.removeAllListeners();
        console.error("connection closed! code: " + code + " reason: \"" + reason + "\"");
        await new Promise(resolve => setTimeout(resolve, cfg.reconnect_interval));
        console.log("reconnecting...");
        ws = new WebSocket(cfg.url);
        ws.on("open", event_listener_open);
        ws.on("error", event_listener_error);
        ws.on("close", event_listener_close);
    };
    
    ws.on("open", event_listener_open);
    ws.on("error", event_listener_error);
    ws.on("close", event_listener_close);
})();
