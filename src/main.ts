import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.11-alpha/deno-dom-wasm.ts";
import { ResponseStart, ResponseAnswer, AnswerAlternatives } from "./types.ts";
import { AkinatorLanguage, Answer, AkinatorUrlType } from "./object.ts";
import * as path from "https://deno.land/std@0.224.0/path/mod.ts";
import { generate } from "https://deno.land/std@0.62.0/uuid/v4.ts";

type AkinatorLanguageType =
    (typeof AkinatorLanguage)[keyof typeof AkinatorLanguage];
type AkinatorUrlTypeType =
    (typeof AkinatorUrlType)[keyof typeof AkinatorUrlType];

interface CacheItem {
    data: {
        session: string;
        signature: string;
        progress: string;
        step: number;
    };
    expiry: number;
}

interface CacheObject {
    [key: string]: CacheItem;
}

function normalizeAnswer(answer: AnswerAlternatives): number {
    if (typeof answer === "number") {
        if (Object.values(Answer).includes(answer)) {
            return answer;
        }
        throw new Error("Invalid answer");
    }

    switch (answer.toLowerCase()) {
        case "y":
        case "yes":
            return Answer.Yes;
        case "n":
        case "no":
            return Answer.No;
        case "idk":
        case "i don't know":
            return Answer.IdontKnow;
        case "p":
        case "probably":
            return Answer.Probably;
        case "pn":
        case "probably not":
            return Answer.ProbablyNot;
        default:
            if (answer in Answer) {
                return Answer[answer as keyof typeof Answer];
            }
            throw new Error("Invalid answer");
    }
}

class AkinatorCache {
    private readonly cacheDir: string;
    private readonly cacheFile: string;
    private readonly cacheDuration = 10 * 60 * 1000;

    constructor() {
        const projectRoot = Deno.cwd();
        this.cacheDir = path.join(projectRoot, "cache");
        this.cacheFile = path.join(this.cacheDir, "akinator.json");
        this.ensureCacheDir();
    }

    private async ensureCacheDir(): Promise<void> {
        try {
            await Deno.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            if (error instanceof Deno.errors.AlreadyExists) {
                // Directory already exists, no need to create it
            } else {
                console.error("Error creating cache directory:", error);
            }
        }
    }

    async set(key: string, value: CacheItem["data"]): Promise<void> {
        try {
            const cacheObject = await this.loadFromFile();
            cacheObject[key] = {
                data: value,
                expiry: Date.now() + this.cacheDuration
            };
            await this.saveToFile(cacheObject);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                await this.saveToFile({});
                await this.set(key, value);
            } else {
                console.error("Error setting cache item:", error);
            }
        }
    }

    async get(key: string): Promise<CacheItem["data"] | null> {
        try {
            const cacheObject = await this.loadFromFile();
            const item = cacheObject[key];
            if (item && item.expiry > Date.now()) {
                return item.data;
            }
            return null;
        } catch (error) {
            console.error("Error getting cache item:", error);
            return null;
        }
    }

    async delete(key: string): Promise<void> {
        try {
            const cacheObject = await this.loadFromFile();
            delete cacheObject[key];
            await this.saveToFile(cacheObject);
        } catch (error) {
            console.error("Error deleting cache item:", error);
        }
    }

    private async saveToFile(cacheObject: CacheObject): Promise<void> {
        try {
            await this.ensureCacheDir();
            await Deno.writeTextFile(
                this.cacheFile,
                JSON.stringify(cacheObject, null, 2)
            );
        } catch (error) {
            console.error("Error saving cache to file:", error);
        }
    }

    private async loadFromFile(): Promise<CacheObject> {
        try {
            await this.ensureCacheDir();
            const data = await Deno.readTextFile(this.cacheFile);
            return JSON.parse(data) as CacheObject;
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                return {};
            } else {
                console.error("Error loading cache from file:", error);
                return {};
            }
        }
    }

    async clearCache(): Promise<void> {
        try {
            await Deno.remove(this.cacheFile);
        } catch (error) {
            console.error("Error clearing cache:", error);
        }
    }
}

export class Akinator {
    private baseUrl: string;
    private answerUrl: string;
    private backUrl: string;
    private signature: string;
    private session: string;
    private question: string;
    private id: string;
    private cache: AkinatorCache;
    private childMode: boolean;
    private readonly headers: { [key: string]: string };

    constructor(
        language: AkinatorLanguageType = AkinatorLanguage.English,
        childMode: boolean = false
    ) {
        this.baseUrl = this.getUrl(language, AkinatorUrlType.Game);
        this.answerUrl = this.getUrl(language, AkinatorUrlType.Answer);
        this.backUrl = this.getUrl(language, AkinatorUrlType.Back);
        this.signature = "";
        this.session = "";
        this.question = "";
        this.cache = new AkinatorCache();
        this.id = generate();
        this.childMode = childMode;
        this.headers = {
            "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
        };
    }

    private getUrl(
        language: AkinatorLanguageType,
        urlType: AkinatorUrlTypeType
    ): string {
        return `https://${language}.akinator.com/${urlType}`;
    }

    async startGame(): Promise<ResponseStart> {
        try {
            const response = await axiod.post(
                this.baseUrl,
                new URLSearchParams({
                    cm: this.childMode.toString(),
                    sid: "1"
                }),
                {
                    headers: this.headers
                }
            );

            const doc = new DOMParser().parseFromString(
                response.data,
                "text/html"
            );
            if (!doc) {
                throw new Error("Error parsing HTML document");
            }

            this.question =
                doc.querySelector("#question-label")?.textContent || "";
            this.session =
                doc
                    .querySelector('form#askSoundlike input[name="session"]')
                    ?.getAttribute("value") || "";
            this.signature =
                doc
                    .querySelector('form#askSoundlike input[name="signature"]')
                    ?.getAttribute("value") || "";

            if (!this.session || !this.signature) {
                return {
                    ok: false,
                    result: {
                        error: "Error starting game: Session or signature missing"
                    }
                };
            }

            await this.cache.set(this.id, {
                session: this.session,
                signature: this.signature,
                progress: "0.00000",
                step: 0
            });

            return {
                ok: true,
                result: {
                    id: this.id,
                    question: this.question
                }
            };
        } catch (error) {
            console.error("Error in startGame:", error);
            return {
                ok: false,
                result: {
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            };
        }
    }

    async answerQuestion(
        answer: AnswerAlternatives,
        id: string
    ): Promise<ResponseAnswer> {
        try {
            const normalizedAnswer = normalizeAnswer(answer);
            const cacheItem = await this.cache.get(id);
            if (!cacheItem) {
                throw new Error(
                    "Game session not found. Please start a new game."
                );
            }

            const response = await axiod.post(
                this.answerUrl,
                new URLSearchParams({
                    step: cacheItem.step.toString(),
                    progression: cacheItem.progress.toString(),
                    answer: normalizedAnswer.toString(),
                    session: cacheItem.session,
                    signature: cacheItem.signature,
                    question_filter: "string",
                    sid: "NaN",
                    cm: this.childMode.toString(),
                    step_last_proposition: ""
                }),
                {
                    headers: this.headers
                }
            );
            if (response.data && !response.data.valide_contrainte) {
                await this.cache.set(id, {
                    ...cacheItem,
                    step: response.data.step,
                    progress: response.data.progression
                });

                return {
                    ok: true,
                    result: {
                        id: id,
                        progress: response.data.progression,
                        step: response.data.step,
                        question: response.data.question
                    }
                };
            } else if (response.data && response.data.valide_contrainte) {
                await this.cache.delete(id);
                return {
                    ok: true,
                    result: {
                        id: id,
                        photo: response.data.photo,
                        description: response.data.description_proposition,
                        name: response.data.name_proposition
                    }
                };
            } else {
                throw new Error("No data received from Akinator API");
            }
        } catch (error) {
            return {
                ok: false,
                result: {
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            };
        }
    }

    async back(id: string): Promise<ResponseAnswer> {
        try {
            const cacheItem = await this.cache.get(id);
            if (!cacheItem) {
                throw new Error(
                    "Game session not found. Please start a new game."
                );
            }

            const response = await axiod.post(
                this.backUrl,
                new URLSearchParams({
                    step: cacheItem.step.toString(),
                    progression: cacheItem.progress.toString(),
                    session: cacheItem.session,
                    signature: cacheItem.signature,
                    cm: this.childMode.toString()
                }),
                {
                    headers: this.headers
                }
            );

            if (response.data) {
                await this.cache.set(id, {
                    ...cacheItem,
                    step: response.data.step,
                    progress: response.data.progression
                });
                return {
                    ok: true,
                    result: {
                        id: id,
                        progress: response.data.progression,
                        step: response.data.step,
                        question: response.data.question
                    }
                };
            } else {
                throw new Error("No data received from Akinator API");
            }
        } catch (error) {
            return {
                ok: false,
                result: {
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            };
        }
    }
}
