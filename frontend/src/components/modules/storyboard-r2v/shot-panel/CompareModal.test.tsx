import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { VideoTask } from "@/lib/api";
import CompareModal from "./CompareModal";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
afterEach(() => vi.restoreAllMocks());
const tasks = [1, 2].map(id => ({ id: `take-${id}`, video_url: `take-${id}.mp4`, status: "completed", model: "wan2.7-r2v" } as VideoTask));

it("pauses on the second Space press inside the synchronized video area", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const view = render(<CompareModal tasks={tasks} onClose={vi.fn()} />);
    const videos = Array.from(document.querySelectorAll("video"));
    videos.forEach(video => { Object.defineProperty(video, "duration", { value: 5, configurable: true }); fireEvent.canPlay(video); });
    pause.mockClear();
    await act(async () => { fireEvent.keyDown(videos[0], { key: " " }); });
    expect(play).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.keyDown(videos[0], { key: " " }); });
    expect(pause).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenCalledTimes(2);
    view.unmount();
});


it("seeks to the same time and keeps shorter videos at the end when resuming", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const view = render(<CompareModal tasks={tasks} onClose={vi.fn()} />);
    const videos = Array.from(document.querySelectorAll("video"));
    videos.forEach((video, index) => { Object.defineProperty(video, "duration", { value: index ? 10 : 5, configurable: true }); fireEvent.canPlay(video); });
    fireEvent.change(screen.getByRole("slider"), { target: { value: 4 } });
    expect(videos.map(video => video.currentTime)).toEqual([4, 4]);
    fireEvent.seeking(videos[0]);
    expect(screen.getByRole("button", { name: "comparePlay" })).toBeDisabled();
    expect(screen.getByRole("slider")).toBeEnabled();
    fireEvent.change(screen.getByRole("slider"), { target: { value: 8 } });
    expect(videos.map(video => video.currentTime)).toEqual([5, 8]);
    fireEvent.canPlay(videos[0]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "comparePlay" })); });
    expect(play.mock.contexts).toEqual([videos[1]]);
    view.unmount();
});

it("keeps playing during clock correction but pauses the group when media needs buffering", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const view = render(<CompareModal tasks={tasks} onClose={vi.fn()} />);
    const videos = Array.from(document.querySelectorAll("video"));
    videos.forEach(video => { Object.defineProperty(video, "duration", { value: 5, configurable: true }); fireEvent.canPlay(video); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "comparePlay" })); });
    pause.mockClear();
    Object.defineProperty(videos[0], "seeking", { value: true, configurable: true });
    fireEvent.seeking(videos[0]);
    fireEvent.waiting(videos[0]);
    expect(screen.getByRole("button", { name: "comparePause" })).toBeVisible();
    expect(pause).not.toHaveBeenCalled();
    Object.defineProperty(videos[0], "seeking", { value: false, configurable: true });
    fireEvent.waiting(videos[0]);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "comparePlay" })).toBeDisabled();
    view.unmount();
});

it("keeps native controls independent and ignores late play results after closing", async () => {
    let finishPlay!: () => void;
    const pending = new Promise<void>(resolve => { finishPlay = resolve; });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(pending);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const onClose = vi.fn();
    const view = render(<CompareModal tasks={tasks} isOpen onClose={onClose} />);
    const videos = Array.from(document.querySelectorAll("video"));
    videos.forEach(video => { Object.defineProperty(video, "duration", { value: 5, configurable: true }); fireEvent.canPlay(video); });
    fireEvent.click(screen.getByRole("checkbox", { name: "compareSync" }));
    expect(videos.every(video => video.controls)).toBe(true);
    fireEvent.keyDown(videos[0], { key: " " });
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "comparePlay" }));
    expect(screen.getByRole("button", { name: "compareStarting" })).toHaveAttribute("aria-disabled", "true");
    view.rerender(<CompareModal tasks={tasks} isOpen={false} onClose={onClose} />);
    await act(async () => { finishPlay(); });
    view.rerender(<CompareModal tasks={tasks} isOpen onClose={onClose} />);
    expect(screen.queryByRole("button", { name: "comparePause" })).not.toBeInTheDocument();
    view.unmount();
});

it("offers media reload and playback retry without closing the comparison", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("play blocked"));
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const view = render(<CompareModal tasks={tasks} onClose={vi.fn()} />);
    const videos = Array.from(document.querySelectorAll("video"));
    videos.forEach(video => { Object.defineProperty(video, "duration", { value: 5, configurable: true }); fireEvent.canPlay(video); });
    fireEvent.error(videos[1]);
    expect(screen.getByRole("alert")).toHaveTextContent("compareLoadFailed");
    expect(screen.getByRole("button", { name: "comparePlay" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "compareReload" }));
    expect(load).toHaveBeenCalledOnce();
    fireEvent.canPlay(videos[1]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "comparePlay" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("comparePlayFailed");
    play.mockResolvedValue();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "comparePlay" })); });
    expect(screen.getByRole("button", { name: "comparePause" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    view.unmount();
});

it("keeps unchanged media ready when a candidate URL refreshes while the dialog is open", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const view = render(<CompareModal tasks={tasks} onClose={vi.fn()} />);
    const videos = Array.from(document.querySelectorAll("video"));
    videos.forEach(video => {
        Object.defineProperties(video, {
            duration: { value: 5, configurable: true },
            readyState: { value: 4, configurable: true },
            currentSrc: { value: video.src, configurable: true },
        });
        fireEvent.canPlay(video);
    });
    view.rerender(<CompareModal tasks={[tasks[0], { ...tasks[1], video_url: "take-2-refreshed.mp4" }]} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "comparePlay" })).toBeDisabled();
    fireEvent.canPlay(videos[1]);
    expect(screen.getByRole("button", { name: "comparePlay" })).toBeEnabled();
    view.unmount();
});
