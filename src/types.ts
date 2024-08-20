import { Answer } from "./object.ts";

export interface ResponseStart {
    ok: boolean;
    result: {
        id?: string;
        question?: string;
        error?: string | Error;
    };
}

export interface ResponseAnswer {
    ok: boolean;
    result: {
        id?: string;
        progress?: number;
        step?: number;
        question?: string;
        error?: string | Error;
        photo?: string;
        description?: string;
        name?: string;
    };
}

export interface AkinatorHeaders {
    readonly "user-agent": string;
}

export type AnswerAlternatives =
    | keyof typeof Answer
    | "y"
    | "yes"
    | "n"
    | "no"
    | "idk"
    | "i don't know"
    | "p"
    | "probably"
    | "pn"
    | "probably not";
