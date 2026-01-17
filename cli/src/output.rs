use colored::Colorize;
use serde::Serialize;

/// Output handler supporting both human-readable and JSON formats
pub struct Output {
    json_mode: bool,
}

#[derive(Serialize)]
struct JsonMessage {
    level: String,
    message: String,
}

#[derive(Serialize)]
pub struct JsonResult<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl Output {
    pub fn new(json_mode: bool) -> Self {
        Self { json_mode }
    }

    pub fn info(&self, message: &str) {
        if self.json_mode {
            let msg = JsonMessage {
                level: "info".to_string(),
                message: message.to_string(),
            };
            println!("{}", serde_json::to_string(&msg).unwrap());
        } else {
            println!("{} {}", "[*]".blue(), message);
        }
    }

    pub fn success(&self, message: &str) {
        if self.json_mode {
            let msg = JsonMessage {
                level: "success".to_string(),
                message: message.to_string(),
            };
            println!("{}", serde_json::to_string(&msg).unwrap());
        } else {
            println!("{} {}", "[+]".green(), message);
        }
    }

    pub fn error(&self, message: &str) {
        if self.json_mode {
            let msg = JsonMessage {
                level: "error".to_string(),
                message: message.to_string(),
            };
            eprintln!("{}", serde_json::to_string(&msg).unwrap());
        } else {
            eprintln!("{} {}", "[!]".red(), message);
        }
    }

    pub fn warning(&self, message: &str) {
        if self.json_mode {
            let msg = JsonMessage {
                level: "warning".to_string(),
                message: message.to_string(),
            };
            println!("{}", serde_json::to_string(&msg).unwrap());
        } else {
            println!("{} {}", "[!]".yellow(), message);
        }
    }

    pub fn progress(&self, message: &str) {
        if self.json_mode {
            let msg = JsonMessage {
                level: "progress".to_string(),
                message: message.to_string(),
            };
            println!("{}", serde_json::to_string(&msg).unwrap());
        } else {
            println!("{} {}", "[>]".cyan(), message);
        }
    }

    pub fn result<T: Serialize>(&self, result: JsonResult<T>) {
        if self.json_mode {
            println!("{}", serde_json::to_string_pretty(&result).unwrap());
        }
    }

    pub fn is_json(&self) -> bool {
        self.json_mode
    }
}
