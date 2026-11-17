//! Minimal parser for Valve's text KeyValues (".vdf" / ".acf") files.

#[derive(Debug, Clone)]
pub enum Vdf {
    Str(String),
    Obj(Vec<(String, Vdf)>),
}

impl Vdf {
    /// case-insensitive child lookup (Steam mixes "Software"/"software", "Apps"/"apps")
    pub fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Obj(v) => v.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v),
            Vdf::Str(_) => None,
        }
    }
    pub fn path(&self, keys: &[&str]) -> Option<&Vdf> {
        keys.iter().try_fold(self, |v, k| v.get(k))
    }
    pub fn str(&self) -> Option<&str> {
        match self {
            Vdf::Str(s) => Some(s),
            Vdf::Obj(_) => None,
        }
    }
    pub fn get_str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(|v| v.str())
    }
    pub fn get_u64(&self, key: &str) -> Option<u64> {
        self.get_str(key).and_then(|s| s.trim().parse().ok())
    }
    pub fn entries(&self) -> &[(String, Vdf)] {
        match self {
            Vdf::Obj(v) => v,
            Vdf::Str(_) => &[],
        }
    }
}

#[derive(Debug, PartialEq)]
enum Tok {
    Open,
    Close,
    Text(String),
}

fn tokenize(src: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut chars = src.chars().peekable();
    while let Some(&c) = chars.peek() {
        match c {
            c if c.is_whitespace() => {
                chars.next();
            }
            '/' => {
                // line comment
                chars.next();
                if chars.peek() == Some(&'/') {
                    for c in chars.by_ref() {
                        if c == '\n' {
                            break;
                        }
                    }
                }
            }
            '{' => {
                chars.next();
                out.push(Tok::Open);
            }
            '}' => {
                chars.next();
                out.push(Tok::Close);
            }
            '[' => {
                // platform conditional such as [$WIN32]: skip
                for c in chars.by_ref() {
                    if c == ']' {
                        break;
                    }
                }
            }
            '"' => {
                chars.next();
                let mut s = String::new();
                while let Some(c) = chars.next() {
                    match c {
                        '"' => break,
                        '\\' => match chars.next() {
                            Some('n') => s.push('\n'),
                            Some('t') => s.push('\t'),
                            Some(other) => s.push(other),
                            None => break,
                        },
                        other => s.push(other),
                    }
                }
                out.push(Tok::Text(s));
            }
            _ => {
                let mut s = String::new();
                while let Some(&c) = chars.peek() {
                    if c.is_whitespace() || c == '{' || c == '}' || c == '"' {
                        break;
                    }
                    s.push(c);
                    chars.next();
                }
                out.push(Tok::Text(s));
            }
        }
    }
    out
}

fn parse_obj(toks: &mut std::iter::Peekable<std::vec::IntoIter<Tok>>) -> Vec<(String, Vdf)> {
    let mut items = Vec::new();
    while let Some(tok) = toks.next() {
        let key = match tok {
            Tok::Close => break,
            Tok::Open => continue,
            Tok::Text(k) => k,
        };
        match toks.peek() {
            Some(Tok::Open) => {
                toks.next();
                items.push((key, Vdf::Obj(parse_obj(toks))));
            }
            Some(Tok::Text(_)) => {
                if let Some(Tok::Text(v)) = toks.next() {
                    items.push((key, Vdf::Str(v)));
                }
            }
            _ => break,
        }
    }
    items
}

pub fn parse(src: &str) -> Vdf {
    let mut toks = tokenize(src).into_iter().peekable();
    Vdf::Obj(parse_obj(&mut toks))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested() {
        let v = parse("\"a\" { \"B\" { \"c\" \"1\" } \"d\" \"x\\\"y\" }");
        assert_eq!(v.path(&["a", "b", "C"]).and_then(|x| x.str()), Some("1"));
        assert_eq!(v.path(&["a", "d"]).and_then(|x| x.str()), Some("x\"y"));
    }
}
