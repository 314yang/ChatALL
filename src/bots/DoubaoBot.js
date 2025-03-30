import AsyncLock from "async-lock";
import Bot from "@/bots/Bot";
import axios from "axios";
import store from "@/store";
import { SSE } from "sse.js";

function generateSectionId() {
  // 获取当前时间戳，精确到毫秒
  const timestamp = Date.now();
  // 生成一个 6 位的随机数
  const randomNum = Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000;
  // 组合时间戳和随机数形成 section_id
  return `${timestamp}${randomNum}`;
}

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 解析 JSON 字符串的辅助函数
function parseJson(jsonString) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error("JSON 解析出错:", error);
    return null;
  }
}

// 从数据项中提取 text 内容的函数
function extractText(dataItem) {
  return dataItem && dataItem.event_data
    ? parseJson(dataItem.event_data) &&
        parseJson(dataItem.event_data).message &&
        parseJson(parseJson(dataItem.event_data).message.content) &&
        parseJson(parseJson(dataItem.event_data).message.content).text
    : null;
}

export function formatPrompt(prompt) {
  return '{"text":"' + prompt.replace(/"/g, '\\"') + '"}';
}

export default class DoubaoBot extends Bot {
  static _brandId = "doubao"; // Brand id of the bot, should be unique. Used in i18n.
  static _className = "DoubaoBot"; // Class name of the bot
  static _logoFilename = "doubao-logo.png"; // Place it in public/bots/
  static _loginUrl = "https://www.doubao.com/";
  static _lock = new AsyncLock(); // AsyncLock for prompt requests

  constructor() {
    super();
  }

  getAuthHeader() {
    return {
      headers: {
        "agw-js-conv": `str`,
        Cookie: `sessionid=${store.state.doubao?.access_token || ""};`,
      },
    };
  }

  /**
   * Check whether the bot is logged in, settings are correct, etc.
   * @returns {boolean} - true if the bot is available, false otherwise.
   */
  async _checkAvailability() {
    try {
      // 发送 POST 请求
      const response = await axios.post(
        "https://www.doubao.com/alice/user/get_account_info",
        {},
        {
          headers: {
            "Content-Type": "application/json",
            Cookie: `sessionid=${store.state.doubao?.access_token};`,
          },
        },
      );

      // 判断返回的 code 是否为 0
      return response.data.code === 0;
    } catch (error) {
      // 如果请求失败，打印错误信息并返回 false
      console.error("Error Doubao _checkAvailability：", error);
      return false;
    }
  }

  /**
   * Send a prompt to the bot and call onResponse(response, callbackParam)
   * when the response is ready.
   * @param {string} prompt
   * @param {function} onUpdateResponse params: callbackParam, Object {content, done}
   * @param {object} callbackParam - Just pass it to onUpdateResponse() as is
   */
  async _sendPrompt(prompt, onUpdateResponse, callbackParam) {
    let context = await this.getChatContext();

    return new Promise((resolve, reject) => {
      const headers = this.getAuthHeader().headers;
      headers["Content-Type"] = "application/json";
      try {
        const source = new SSE(
          `https://www.doubao.com/samantha/chat/completion`,
          {
            headers,
            payload: JSON.stringify({
              messages: [
                {
                  content: formatPrompt(prompt),
                  content_type: 2001,
                  attachments: [],
                  references: [],
                },
              ],
              /*"completion_option": {
                "is_regen": false,
                "with_suggest": true,
                "need_create_conversation": false,
                "launch_stage": 1,
                "is_replace": false,
                "is_delete": false,
                "message_from": 0,
                "use_deep_think": false,
                "event_id": "0"
              },*/
              section_id: context.section_id || "",
              local_message_id: uuidv4(),
            }),
            withCredentials: true,
          },
        );

        let body = "";
        source.addEventListener("message", (event) => {
          const data = JSON.parse(event.data);
          console.log(`doubao response: ${data}`);

          if (data.event_type === 2001) {
            body += extractText(data);
          }

          if (data.event_type === 2003) {
            onUpdateResponse(callbackParam, {
              content: `${body}`,
              done: true,
            });
            resolve();
          } else {
            onUpdateResponse(callbackParam, {
              content: `${body}`,
              done: false,
            });
          }
        });
        source.stream();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Should implement this method if the bot supports conversation.
   * The conversation structure is defined by the subclass.
   * @param null
   * @returns {any} - Conversation structure. null if not supported.
   */
  async createChatContext() {
    let context = null;
    new Promise((resolve, reject) => {
      const headers = this.getAuthHeader().headers;
      headers["Content-Type"] = "application/json";
      try {
        const source = new SSE(
          `https://www.doubao.com/samantha/chat/completion`,
          {
            headers,
            payload: JSON.stringify({
              messages: [
                {
                  content: formatPrompt("1"),
                  content_type: 2001,
                  attachments: [],
                  references: [],
                },
              ],
              completion_option: {
                is_regen: false,
                with_suggest: true,
                need_create_conversation: true,
                launch_stage: 1,
                is_replace: false,
                is_delete: false,
                message_from: 0,
                use_deep_think: false,
                event_id: 0,
              },
              conversation_id: 0,
              local_conversation_id: "local_" + generateSectionId(),
              local_message_id: uuidv4(),
            }),
          },
        );

        source.addEventListener("message", (event) => {
          const data = JSON.parse(event.data);
          console.log(`doubao response: ${data}`);
          //data: {"event_data":"{\"message_id\":\"2338680402654978\",\"local_message_id\":\"70895300-0d09-11f0-bfa9-a767fe08a5d8\",\"conversation_id\":\"2348487921876738\",\"local_conversation_id\":\"local_2420824114240234\",\"section_id\":\"2348487921876994\",\"message_index\":1,\"conversation_type\":5}","event_id":"0","event_type":2002}
          // if "event_id":"0" 取 conversation_id，section_id，local_message_id
          if (data.event_id === "0") {
            const eventData = JSON.parse(data.event_data);
            const { conversation_id, section_id, local_message_id } = eventData;
            context.conversation_id = conversation_id;
            context.section_id = section_id;
            context.local_message_id = local_message_id;
          }
        });
      } catch (err) {
        reject(err);
      }
    });

    return context;
  }
}
