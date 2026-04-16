require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// 알림 메시지 결정 함수
function getRemindMessage(hour) {
    if (hour === 11) return "좋은 아침이에요! 오늘도 잊지 말고 출근 도장 꾹 눌러주세요? ✨";
    if (hour === 14) return "벌써 오후 2시에요! 설마 오늘 출근 까먹으신 건 아니죠...? 얼른 오세요! 🤨";
    if (hour === 17) return "이제 해가 지려고 해요... 오늘 출근 안 하시면 연속 기록이 깨질지도 몰라요. 제발 와주세요. 😭";
    if (hour === 18) return "저기요... 아직도 안 오신 건가요? 6시예요. 이제 슬슬 걱정되기 시작하네요. 😟";
    if (hour === 19) return "7시입니다. 당신의 연속 출근 기록이 공중분해 되기 직전이에요. 지금 당장 오세요! ⚡";
    if (hour === 20) return "8시... 이제 제 목소리가 들리지 않나요? 당신의 성실함이 시험받고 있어요. ✊";
    if (hour === 21) return "9시예요. 이대로 포기하실 건가요? 지금까지 쌓아온 노력이 아깝지 않으세요? 😠";
    if (hour === 22) return "10시입니다. 이제 시간이 얼마 없어요. 제발... 마지막 기회일지도 몰라요. 🙏";
    if (hour === 23) return "11시!!! 이제 한 시간 뒤면 모든 게 끝납니다. 죽기 살기로 출근하세요! 빨리!!! 🚨🚨";
    return null;
}

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);

    // 알림 스케줄러: 매시 정각(0분)마다 실행
    cron.schedule('0 * * * *', async () => {
        const now = new Date();
        const kstOffset = 9 * 60 * 60 * 1000;
        const kstDate = new Date(now.getTime() + kstOffset);
        const today = kstDate.toISOString().split('T')[0];
        const currentHour = kstDate.getUTCHours();

        console.log(`⏰ 알림 체크: 현재 한국 시간 ${currentHour}시`);

        const messageText = getRemindMessage(currentHour);
        
        if (messageText) {
            const { data: allUsers } = await supabase.from('attendance').select('*');
            if (allUsers) {
                for (const user of allUsers) {
                    // 오늘 아직 출근 안 한 유저만 타겟팅
                    if (user.last_checkin !== today) {
                        try {
                            const discordUser = await client.users.fetch(user.user_id);
                            await discordUser.send(`🔔 <@${user.user_id}>님! ${messageText}`);
                            console.log(`✉️ ${user.username}님께 DM 전송 완료 (${currentHour}시)`);
                        } catch (err) {
                            console.error(`${user.username} DM 전송 실패:`, err.message);
                        }
                    }
                }
            }
        }
    });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const username = message.author.username;
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset);
    const today = kstDate.toISOString().split('T')[0];
    const currentHour = kstDate.getUTCHours();

    // [테스트 기능] "듀오링고"라고 치면 즉시 DM 발송 체크
    if (message.content === "듀오링고") {
        const testMsg = getRemindMessage(currentHour) || "현재는 정기 알림 시간이 아니지만, 시스템은 정상입니다! 🔥";
        try {
            await message.author.send(`🧪 **[테스트 알림]**\n🔔 <@${userId}>님! ${testMsg}`);
            return message.reply("성공! 개인 DM을 확인해보세요. 📩");
        } catch (err) {
            return message.reply("DM을 보낼 수 없어요. 설정을 확인해주세요!");
        }
    }

    if (message.content !== "출근") return;

    // 새벽 0시 ~ 4시 출근 제한
    if (currentHour >= 0 && currentHour < 4) {
        return message.reply("🚫 **지금은 출근 금지 시간입니다!**\n상쾌한 아침 공기를 마시며 다시 와주세요! 😴");
    }

    try {
        const { data: user, error: selectError } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (selectError) throw selectError;

        if (user && user.last_checkin === today) {
            return message.reply(`이미 오늘 출근하셨어요! ✨\n(오늘 날짜: ${today})`);
        }

        let newStreak = 1;
        if (user && user.last_checkin) {
            const yesterday = new Date(kstDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (user.last_checkin === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        const { error: upsertError } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                username: username,
                last_checkin: today,
                streak: newStreak
            }, { onConflict: 'user_id' });

        if (upsertError) throw upsertError;
        message.reply(`✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥`);

    } catch (err) {
        console.error(err);
        message.reply("⚠️ DB 처리 중 오류가 발생했습니다!");
    }
});

client.login(process.env.DISCORD_TOKEN);
