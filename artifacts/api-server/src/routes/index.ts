import { Router, type IRouter } from "express";
import healthRouter from "./health";
import threadsRouter from "./threads";
import messagesRouter from "./messages";
import settingsRouter from "./settings";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(threadsRouter);
router.use(messagesRouter);
router.use(settingsRouter);
router.use(statsRouter);

export default router;
